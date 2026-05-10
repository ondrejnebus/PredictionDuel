# PredictionDuel

> Trustless peer-to-peer wagers on a yes/no outcome, with **asymmetric stakes**,
> a **soulbound on-chain reputation NFT**, and a **Kleros-style 3-tier jury**
> for disputes - settled end-to-end on Ethereum Sepolia.

**DMBLOCK - Assignment 2 (Decentralized Applications), 2025/2026.**

---

## 1. What it does (and why)

Two people disagree about whether something will happen. Today they use a
group chat, a handshake, and good faith. PredictionDuel replaces all three
with one Solidity contract:

1. **Creator** stakes ETH, picks a yes/no question, picks **both** stakes (so a
   confident creator can deliberately give the underdog a 4-to-1 payoff edge),
   and sets two deadlines.
2. **Opponent** matches the opposite-side stake. The reputation gate (optional)
   keeps low-rep accounts out of high-stake duels.
3. After the event, **both parties vote** on what actually happened.
4. If they agree -> the contract pays the winner automatically.
   If they disagree -> a **3 / 5 / 7-juror Kleros-style panel** resolves it;
   minority jurors are slashed.
5. Every settled duel updates a **soulbound ERC-721** reputation NFT - wins are
   stake-weighted (`log2`), no-shows are sticky, positive reputation decays
   yearly.

**Why on-chain.** The point isn't to be cheaper than a bookmaker - it's that
the *resolution mechanism* is itself trustless. Centralised prediction markets
still need a trusted oracle. Kleros-style jury + soulbound reputation gives us
a closed loop where dispute resolution and accountability are both on-chain.

## 2. Live deployment (Sepolia)

| Contract | Address | Etherscan |
|---|---|---|
| `PredictionDuel` | `0x34e27a22f82aCBBEA6672627B3C8c8AF006733C4` | [verified source](https://sepolia.etherscan.io/address/0x34e27a22f82aCBBEA6672627B3C8c8AF006733C4#code) |
| `DuelReputation` | `0x8E351b767e54CE32dEbd6fBD7d456d50eAEcB595` | [verified source](https://sepolia.etherscan.io/address/0x8E351b767e54CE32dEbd6fBD7d456d50eAEcB595#code) |

- **Network:** Ethereum Sepolia (chain id `11155111`).
- **Deployer:** `0x5A684A789998B4Cf338c244073F996575BB5f66e`.
- **Constructor wiring:** counterfactual two-step deploy (see [Architecture](#3-architecture)).
- **Frontend:** Next.js 15 app, lives in [`frontend/`](frontend/). Hosted URL listed in
  [`docs/sepolia-validation.md`](docs/sepolia-validation.md) once deployed; otherwise run
  locally with `cd frontend && npm install && npm run dev`.

> **End-to-end demo:** open the frontend, connect a Sepolia wallet (faucet:
> https://sepoliafaucet.com), create a duel, accept from a second wallet, vote,
> settle - all advertised flows work against the verified addresses above
> without any local workaround. The full validation log is in
> [`docs/sepolia-validation.md`](docs/sepolia-validation.md).

## 3. Architecture

```
                ┌────────────────────────────┐
                │   Next.js 15 + wagmi v2    │  RainbowKit wallet
                │   (frontend/, App Router)  │  ChainGuard -> Sepolia
                └──────────────┬─────────────┘
                               │ viem JSON-RPC
                               ▼
        ┌──────────────────────────────────────────────────┐
        │            PredictionDuel.sol  (Sepolia)         │
        │                                                  │
        │  createDuel -> acceptDuel -> submitVote -> settle   │
        │  • disagreement -> DISPUTED                       │
        │  • escalateToJury -> claimDispute(FIFO) -> vote    │
        │  • finalizeJuryRound -> appealDispute (rounds 1-3)│
        │  • pendingWithdrawals[user] (pull-payment)       │
        └────────────┬──────────────────────────────┬──────┘
                     │ recordWin/Loss/DisputeWin/.. │ reads score
                     ▼                              │
        ┌──────────────────────────────────────────┴──────┐
        │           DuelReputation.sol  (Sepolia)         │
        │                                                  │
        │  ERC-721, soulbound (transfer reverts)           │
        │  tokenId = uint256(uint160(addr))                │
        │  score = log2-weighted wins − dispute losses     │
        │          − sticky no-show penalty − decay        │
        │  duelContract = immutable (set in constructor)   │
        └──────────────────────────────────────────────────┘
```

The two contracts reference each other in their constructors and
`DuelReputation.duelContract` is `immutable`. The deploy script uses the
**counterfactual pattern** (predict PredictionDuel's CREATE address from the
deployer's nonce, deploy DuelReputation with that address, then deploy
PredictionDuel) so the link cannot be re-pointed by anyone - including the
deployer.

For Mermaid sequence diagrams of the duel lifecycle and the jury escalation
state machine, see [`docs/architecture.md`](docs/architecture.md).

## 4. Contracts

| Contract | Purpose | Bytecode |
|---|---|---|
| `PredictionDuel.sol` | Wager lifecycle, voting, settlement, jury dispute resolution | ~13 KB |
| `DuelReputation.sol` | Soulbound ERC-721 reputation tracker (one token per address) | ~8 KB |
| `mocks/ReentrantAttacker.sol` | Test-only contract used to verify CEI / `nonReentrant` on `withdraw()` | - |

Compiled with optimizer (`runs: 200`) and `viaIR: true`, Solidity 0.8.35.

### Lifecycle

* `createDuel` - creator stakes `msg.value`, sets the opponent's required
  stake, the bet outcome (YES / NO), an optional `minOpponentReputation` gate,
  a `voteDeadline`, and a `resolutionDeadline`.
* `acceptDuel` - opponent matches the stake before `voteDeadline`. Reputation
  gate (if any) is enforced here.
* `submitVote` - each party reports the actual outcome (YES / NO / INVALID).
* `settleDuel` - anyone can call after `voteDeadline`:
  * Both agree (non-INVALID) -> winner gets the full pot, reputation updated.
  * Both vote INVALID -> clean refund.
  * Both no-show after `resolutionDeadline` -> refund + double no-show penalty.
  * One no-show -> solo voter wins the pot, no-shower is penalised.
  * Disagreement -> status moves to `DISPUTED` and waits for `escalateToJury`.
* `withdraw` - pull-payment claim of any credited balance.

### Asymmetric stakes & pull payment

The creator picks both stakes at create-time, so a 0.8 ETH-vs-0.2 ETH duel is
explicit handicapping. All payouts (winner credit, refunds, juror rewards,
slashed dust) go through `pendingWithdrawals` and require `withdraw()` - a
recipient that rejects ETH cannot brick the duel for the counterparty.

### Reputation (DuelReputation)

* Token id is deterministic: `tokenId = uint256(uint160(addr))`. One NFT per
  address, soulbound (`_update` reverts when both `from` and `to` are non-zero).
* Lazy-minted on the first record event for that address.
* Score = `decayed_winPoints + (disputesWon x 1) − (disputesLost x 10)
         − noShowPenaltyAccum`.
* Win points are stake-weighted: `2 + log2(stake / 0.001 ETH)`, so a 1 ETH win
  is worth 11 points and a 0.001 ETH wash-trade is worth 2.
* No-show penalty is `max(10, currentScore / 5)` so high-rep accounts cannot
  shrug off a no-show.
* Positive reputation halves every 365 days of inactivity (capped at 30
  halvings). Negative reputation never decays.
* `tokenURI` returns inline base64 JSON metadata with all counters as traits -
  the frontend decodes this for the on-profile NFT preview.

### Jury dispute resolution

When `settleDuel` sees disagreeing votes the duel is parked in `DISPUTED`.

| Constant | Value |
|---|---|
| `DISPUTE_FEE` | 0.01 ETH |
| `JUROR_STAKE` | 0.05 ETH |
| `SLASH_AMOUNT` | 0.02 ETH |
| `VOTING_PERIOD` | 48 h |
| `APPEAL_WINDOW` | 24 h |
| `ESCALATION_GRACE` | 7 days |

| Round | Jurors | Fee |
|---|---|---|
| 1 | 3 | 1x `DISPUTE_FEE` (0.01 ETH) |
| 2 | 5 | 3x (0.03 ETH) |
| 3 | 7 | 9x (0.09 ETH) |

**Flow**

1. **Escalate** - either side calls `escalateToJury(id)` paying `DISPUTE_FEE`.
   The duel id enters a FIFO queue; the fee enters the dispute's fee pool.
2. **Stake & claim** - anyone with `JUROR_STAKE` worth of ETH staked via
   `stakeAsJuror()` can call `claimDispute()` to claim the queue's front.
   Once enough jurors have claimed it the queue advances and a `VOTING_PERIOD`
   opens. Duel participants are blocked from joining their own panel.
3. **Vote** - `juryVote(id, outcome)` during the voting window.
4. **Tally** - anyone calls `finalizeJuryRound(id)`:
   * Majority verdict wins; minority jurors lose `SLASH_AMOUNT`.
   * Round 1 / 2 -> opens an `APPEAL_WINDOW`.
   * Round 3, or any round that produces an INVALID verdict -> final.
5. **Appeal** - the round loser may call `appealDispute(id)` paying the next
   tier's fee. The dispute is re-queued with the previous panel cleared.
6. **Finalize** - when the appeal window expires without an appeal, anyone
   calls `finalizeJuryRound(id)` again to lock in the verdict and pay out:
   * Winner gets the full pot. Loser eats `recordLoss` + `recordDisputeLoss`.
   * The fee pool (escalation fees + slashed stakes) is split equally among
     majority jurors of the final round.
   * **INVALID verdict**: both stakes are refunded *and* the fee pool is split
     50/50 between the participants - escalators are not punished for an
     inconclusive jury.

**Stuck disputes** - `cancelStaleDispute(id)` lets anyone refund a duel that
has been DISPUTED for longer than `ESCALATION_GRACE` past `resolutionDeadline`
without anyone escalating. Funds never permanently lock.

## 5. Frontend

Next.js 15 (App Router) + TypeScript + wagmi v2 + viem + RainbowKit v2 +
Tailwind + sonner. Lives in [`frontend/`](frontend/).

| Page | Purpose |
|---|---|
| `/` | Landing page - pitch + feature cards. |
| `/duels` | Browse open and active duels. |
| `/duels/[id]` | Duel detail - accept / vote / settle / **escalate / appeal**, full DisputeData (panel, fee pool, deadlines), live countdown. |
| `/create` | Create a duel with ETH ↔ USD toggle, stake-ratio presets, deadline pickers. |
| `/jury` | Stake as juror, see queue, claim disputes, vote, finalize. |
| `/profile` | Reputation card, **soulbound NFT preview** (decoded from on-chain `tokenURI`), pending balance withdraw, **stake / unstake** as juror, my duels. |

All write paths go through wagmi's `useWriteContract` + a `useTxToast` hook
that surfaces pending -> success / failure with sonner toasts. Errors are
parsed through `explainError` so revert reasons (e.g. `WrongStakeAmount`) reach
the user instead of "transaction failed". `ChainGuard` blocks all action
panels until the wallet is on Sepolia.

## 6. Project layout

```
contracts/
  PredictionDuel.sol      core contract
  DuelReputation.sol      soulbound reputation NFT
  mocks/                  test-only contracts
test/
  PredictionDuel.test.ts  72 tests covering the full flow
  DuelReputation.test.ts  24 isolated reputation tests
scripts/
  deploy.ts               counterfactual two-contract deploy
  verify.ts               Etherscan verify driver
  interact.ts             smoke-test by creating a 0.001 ETH duel
deployments/
  <network>.json          addresses + constructor args (written by deploy.ts)
frontend/
  app/                    Next.js App Router pages
  components/             reusable UI (cards, badges, tx-status, chain-guard…)
  lib/                    contract bindings, ABIs, formatters, hooks
hardhat.config.ts         Hardhat 3 config (ESM)
```

## 7. Setup & local development

### Prerequisites
- Node.js ≥ 20
- A Sepolia wallet with test ETH for the deployer (only needed if you redeploy)

### Contracts

```bash
npm install
cp .env.example .env       # then fill in values for non-local networks
npm run compile
npm test                   # mocha + solidity tests (96 tests)
npm run coverage           # hardhat coverage (HH3 native)
npm run test:gas           # hardhat test --gas-stats
```

`.env` is auto-loaded at the top of `hardhat.config.ts` via `dotenv/config`.
Values are read lazily through Hardhat 3's `configVariable(...)`, so they're
only required when a task actually needs them (`--network sepolia`, `verify`).

| Key | Purpose |
|---|---|
| `SEPOLIA_RPC_URL` | RPC endpoint for the Sepolia testnet |
| `PRIVATE_KEY` | Deployer wallet private key (with or without `0x`) |
| `ETHERSCAN_API_KEY` | Etherscan v2 API key (single key, all supported chains) |

For production secrets, prefer Hardhat 3's encrypted keystore instead of `.env`:

```bash
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
```

### Frontend

```bash
cd frontend
npm install
npm run dev                # http://localhost:3000
```

Contract addresses, chain id, and RPC URL are read from `.env.local`. A
working `.env.local` is committed pointing at the existing Sepolia
deployment; replace values to point at your own deployment.

After re-compiling Solidity, regenerate the typed ABIs (the `as const` is
important - wagmi v2 derives strict types from the literal ABI):

```bash
node -e "const fs=require('fs');function emit(n,p){const a=JSON.parse(fs.readFileSync(p,'utf8'));fs.writeFileSync('frontend/lib/abis/'+n+'.ts','export const '+n+'Abi = '+JSON.stringify(a.abi,null,2)+' as const;\n');}emit('predictionDuel','artifacts/contracts/PredictionDuel.sol/PredictionDuel.json');emit('duelReputation','artifacts/contracts/DuelReputation.sol/DuelReputation.json');"
```

### Deployment

```bash
# Local dry run
npx hardhat node                                           # in another terminal
npx hardhat run scripts/deploy.ts --network localhost

# Sepolia
npx hardhat run scripts/deploy.ts   --network sepolia
npx hardhat run scripts/verify.ts   --network sepolia      # Etherscan verification
npx hardhat run scripts/interact.ts --network sepolia      # smoke-test (creates a 0.001 ETH duel)
```

The deploy script writes addresses, constructor args, and tx hashes to
`deployments/<network>.json`, which `verify.ts` and `interact.ts` then read.

The frontend can be deployed to Vercel with one command (root directory:
`frontend`, framework: Next.js auto-detected). The four `NEXT_PUBLIC_*`
variables from `frontend/.env.local` need to be set in the Vercel project
settings.

## 8. Testing

| Suite | Tests | Coverage |
|---|---|---|
| `test/PredictionDuel.test.ts` | 72 | 97.08 % statements |
| `test/DuelReputation.test.ts` | 24 | 100.00 % statements |
| **Total** | **96** | - |

Run with `npm test`; coverage report with `npm run coverage` (HTML in
`coverage/html/index.html`).

The test suite explicitly covers:
* Critical paths - create / accept / vote / settle for every win/lose/refund
  branch.
* **Failure cases** - wrong stake, double-vote, vote after deadline, settle
  before deadline, non-participant voting, non-creator cancel, opponent self-
  accept, soulbound transfer revert, non-duel caller writing reputation,
  reentrancy attempt against `withdraw`, ineligible-juror `claimDispute`,
  appeal by non-loser, appeal with wrong fee, escalate non-DISPUTED duel,
  cancelStaleDispute before grace, etc.
* Reputation math - log2 stake bounds, decay halvings, sticky no-show penalty,
  signed score rendering in `tokenURI`.
* Jury - panel assembly, voting, slashing, fee-pool distribution, full
  3-round escalation, INVALID-verdict 50/50 fee refund, tied juries.

## 9. Creativity & design choices

This isn't a tutorial clone of Kleros or a generic prediction market; the
specific combination is the contribution:

1. **Asymmetric stakes** - the creator picks both stakes, so confidence
   asymmetry is encoded in the wager (a 4 : 1 stake ratio means a 4 : 1 payoff
   asymmetry). Most prediction markets force 1:1 because they price liquidity
   pools, not bilateral bets.
2. **Soulbound, log2-weighted reputation** - a 1 ETH win is worth ~5x a
   0.001 ETH win, but only via `log2`, so wash-trading at scale doesn't pay.
   Negative reputation is sticky, positive halves yearly. Token ID derived
   directly from the address removes the entire enumeration / mint-griefing
   surface.
3. **Reputation gate baked into accept** - `minOpponentReputation` lets a
   creator refuse low-rep accounts without an off-chain whitelist.
4. **3-tier Kleros-style jury with fee escalation** - round losers pay 1x /
   3x / 9x fees so that frivolous appeals self-fund honest jurors, and the
   fee pool is split exactly among the majority of the final round only.
5. **INVALID verdict refunds the fee pool 50/50** - escalators aren't
   punished for an inconclusive jury, which Kleros leaves underspecified.
6. **`cancelStaleDispute` safety valve** - if both parties go quiet during a
   dispute, anyone can force a refund after `ESCALATION_GRACE`. Funds never
   permanently lock.
7. **Counterfactual two-contract deploy** - `DuelReputation.duelContract` is
   `immutable`, so once deployed the cross-reference can't be re-pointed.
8. **Pull-payment everywhere** - winner credit, refunds, juror rewards, even
   the INVALID-verdict fee refund all flow through `pendingWithdrawals`. A
   wallet that rejects ETH cannot grief its counterparty.

## 10. Security awareness

* **Reentrancy** - `nonReentrant` on every payable function and on `withdraw`.
  Tested with a malicious receiver (`mocks/ReentrantAttacker.sol`).
* **CEI** - effects (status updates, balance credits) precede the single
  external transfer in `withdraw`.
* **Access control** - `recordWin / recordLoss / recordDispute* /
  recordNoShow / mintIfNeeded` are gated by `onlyDuelContract`. Verified by
  test R10/R11.
* **Integer handling** - Solidity 0.8.35 checked math. Only `unchecked` blocks
  are local counters where overflow is impossible (e.g. `++i` in bounded loops,
  credit accumulation guarded upstream).
* **Front-running** - `acceptDuel` is first-come-first-served by design;
  there is no MEV-sensitive ordering.
* **Oracle dependence** - none. The voting / dispute mechanism *is* the
  oracle; we don't trust an external feed.
* **Known limitations** - see [§12](#12-known-limitations).

## 11. What we learned

- **Hardhat 3's ESM-first config and lazy `configVariable`** felt awkward
  at first but saved us from a class of "I forgot to set X for local tests"
  bugs. We shipped one bad commit because we used `process.env.X` instead of
  `configVariable("X")` and the value resolved at module-load time.
- **viaIR + optimizer made stack-too-deep go away** the moment we added
  `getDisputeData` returning ten fields. Without `viaIR` we'd have had to
  split the struct into multiple views.
- **Designing the jury state machine on paper first** was the single highest-
  leverage decision. We tried writing it inline and produced two reentrancy
  surfaces; the diagram in `docs/architecture.md` is what the contract was
  actually built from.
- **Soulbound ERC-721 is more subtle than it looks** - overriding `_update`
  to revert on transfers is the right hook, but we initially blocked
  `mintIfNeeded` too. Test R7/R8/R9 nailed the boundary.
- **Pull-payment is non-negotiable** for any contract that pays multiple
  recipients. Our first prototype paid winners directly; a single contract
  that rejected ETH would have bricked any duel involving it. That refactor
  also unlocked the INVALID-verdict 50/50 fee refund cleanly.
- **wagmi v2 + viem with `as const` ABIs** gives surprisingly strong types
  end-to-end. The price was occasionally fighting the discriminated-union arg
  type for `writeContract` when calling it through a generic helper.
- **End-to-end on a public testnet is a different skill from unit tests.**
  Sepolia has flaky public RPCs, MetaMask occasionally caches stale chain
  state, and "the same wallet on two tabs" produces nonce races. The
  `docs/sepolia-validation.md` log was as much about catching frontend race
  conditions as about validating the contracts.

## 12. Known limitations

* **Juror selection is self-service.** `claimDispute()` lets any staked juror
  pick up the queue's front. With enough capital a single actor could pack a
  panel; a future hardening would draw jurors with on-chain randomness
  (Chainlink VRF) or a stake-weighted lottery.
* **No commit-reveal.** Jurors vote in plaintext, so later voters can copy
  earlier voters within the same `VOTING_PERIOD`. Schelling-point pressure
  partly mitigates this; a commit-reveal phase would be stronger.
* **Disputed duels need someone to escalate.** If neither party pays
  `DISPUTE_FEE`, the duel sits in DISPUTED until `ESCALATION_GRACE`, at which
  point `cancelStaleDispute` refunds both sides.
* **Integer-division dust** in juror reward distribution stays in the
  contract. With a 7-juror final round this is at most 6 wei per dispute.
* **No subjective question moderation.** A creator can post a malformed or
  ambiguous question; the only recourse is for both parties to vote INVALID
  or for jurors to do so.

Given more time we would: add a commit-reveal phase, draw jurors via VRF,
add an L2 deployment, and build a Subgraph so the frontend can paginate
historic duels without scanning storage.

## 13. Conclusion

PredictionDuel is a deliberately small protocol with a deliberately
opinionated design. The interesting work isn't "yes/no bets on chain" - that's
trivial - it's the *resolution side*: asymmetric stakes encoded as payoff
asymmetry, soulbound reputation that can't be transferred or wash-traded
profitably, and a 3-tier jury whose fees self-balance honest behaviour. We
were able to build it, test it (97 % / 100 % coverage, 96 tests, including
explicit failure cases and a reentrancy attacker), deploy and verify it on
Sepolia, and drive every advertised user flow end-to-end through the
frontend.

Things we'd build next:
1. Commit-reveal for jurors (closes the copy-vote attack surface).
2. VRF-based juror draw (closes the panel-packing attack surface).
3. L2 deployment + Subgraph for cheaper UX and historical pagination.
4. Mobile-first PWA shell with WalletConnect deep links.