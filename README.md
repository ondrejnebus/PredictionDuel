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

1. **Creator** stakes ETH, writes a yes/no question + an optional long-form
   **description** (resolution rules, source URL), picks **both** stakes (so a
   confident creator can deliberately give the underdog a 4-to-1 payoff edge),
   and sets three timestamps: when **voting opens**, when it **closes**, and
   the **resolution deadline** for no-show fallbacks.
2. **Opponent** matches the opposite-side stake **before voting opens**, so
   nobody can join after the event is already known. The reputation gate
   (optional) keeps low-rep accounts out of high-stake duels.
3. After the event, **both parties vote** on what actually happened.
4. If they agree -> the contract pays the winner automatically.
   If they disagree -> a tiered Kleros-style jury (**1 -> 3 -> 5 jurors** across
   appeals) resolves it through commit-reveal voting; minority jurors and
   non-revealers are slashed.
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
| `PredictionDuel` | `0x251968A3BF080AA888609Aa2114DB9fC017fd84A` | [verified source](https://sepolia.etherscan.io/address/0x251968A3BF080AA888609Aa2114DB9fC017fd84A#code) |
| `DuelReputation` | `0xa7E719C61CC259739B025E07f1785d455f5Bc0b6` | [verified source](https://sepolia.etherscan.io/address/0xa7E719C61CC259739B025E07f1785d455f5Bc0b6#code) |

- **Network:** Ethereum Sepolia (chain id `11155111`).
- **Deployer:** `0x5A684A789998B4Cf338c244073F996575BB5f66e`.
- **Constructor wiring:** counterfactual two-step deploy (see [Architecture](#3-architecture)).
- **Frontend:** Next.js 15 app, lives in [`frontend/`](frontend/). Hosted URL:
  [`xebus.xyz`](https://www.xebus.xyz/)

> **End-to-end demo:** open the frontend, connect a Sepolia wallet (faucet:
> https://sepoliafaucet.com), create a duel, accept from a second wallet, vote,
> settle - all advertised flows work against the verified addresses above
> without any local workaround.

## 3. Architecture

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

A duel has three configurable timestamps:

```
   t=0 (create)        votingStart        voteDeadline        resolutionDeadline
   |                     |                    |                    |
   |--- acceptance ------|------ voting ------|--- settle window --|--- no-show ---
   |                     |                    |
   acceptDuel must close commit phase opens   settleDuel callable
   before this           submitVote allowed   after this
```

* `createDuel(question, description, creatorOutcome, opponentStake, minOpponentReputation, votingStart, voteDeadline, resolutionDeadline)` -
  creator stakes `msg.value` and sets all three timestamps.
* `acceptDuel` - opponent matches the stake **before `votingStart`**, so they
  cannot accept after the event is already known. Reputation gate (if any)
  is enforced here.
* `submitVote` - each party reports the actual outcome (YES / NO / INVALID).
  Only callable inside `[votingStart, voteDeadline)`.
* `settleDuel` - anyone can call after `voteDeadline`:
  * Both agree (non-INVALID) -> winner gets the full pot, reputation updated.
  * Both vote INVALID -> clean refund.
  * Both no-show after `resolutionDeadline` -> refund + double no-show penalty.
  * One no-show -> solo voter wins the pot, no-shower is penalised.
  * Disagreement -> status moves to `DISPUTED` and waits for `escalateToJury`.
* `withdraw` - pull-payment claim of any credited balance.

**Why a separate `votingStart`.** A natural duel like *"Will BTC close above
$50k on Dec 31, 2026?"* needs to delay voting until after the event resolves.
If the vote could happen at any time before the deadline, the opponent could
accept after the event is known and immediately submit the right vote. Having
a `votingStart` strictly later than the event time, and forcing
`acceptDuel < votingStart`, removes that degree of freedom.

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
| `COMMIT_PERIOD` | 24 h |
| `REVEAL_PERIOD` | 24 h |
| `APPEAL_WINDOW` | 24 h |
| `ESCALATION_GRACE` | 7 days |

| Round | Jurors | Fee |
|---|---|---|
| 1 | 1 | 1x `DISPUTE_FEE` (0.01 ETH) |
| 2 | 3 | 3x (0.03 ETH) |
| 3 | 5 | 9x (0.09 ETH) |

Round 1 starts with a single arbiter - fast and cheap for clear-cut cases. The
panel grows by 2 (odd sizes prevent ties) only when the round loser pays the
escalating appeal fee, so frivolous appeals self-fund honest jurors.

**Flow**

1. **Escalate** - either side calls `escalateToJury(id)` paying `DISPUTE_FEE`.
   The duel id enters a FIFO queue; the fee enters the dispute's fee pool.
2. **Stake & claim** - anyone with `JUROR_STAKE` worth of ETH staked via
   `stakeAsJuror()` can call `claimDispute()` to claim the queue's front.
   Once enough jurors have claimed it the queue advances; a `COMMIT_PERIOD`
   opens followed by an equal-length `REVEAL_PERIOD`. Duel participants are
   blocked from joining their own panel.
3. **Commit** - during the commit phase each juror calls
   `commitJuryVote(id, hash)` where `hash = keccak256(abi.encode(duelId,
   juror, vote, salt))`. The plaintext vote stays off-chain; only the hash is
   on-chain, so jurors cannot copy each other.
4. **Reveal** - after `COMMIT_PERIOD` ends, anyone calls
   `revealJuryVote(id, juror, vote, salt)`. The reveal is **permissionless**
   on purpose: the hash binding to `(duelId, juror, vote, salt)` makes it
   impossible to frame a juror with a vote they did not commit, so the
   contract does not need to check `msg.sender`. This means a juror only has
   to send a single wallet transaction (the commit) - the reveal can be
   delivered by the juror returning to the site (auto-revealed by the
   frontend), by a relayer the juror posted `(vote, salt)` to, or by any
   third party who happens to know the salt.
5. **Tally** - after the reveal phase ends, anyone calls
   `finalizeJuryRound(id)`:
   * Majority of *revealed* votes wins. Minority jurors *and non-revealers*
     lose `SLASH_AMOUNT`.
   * Round 1 / 2 -> opens an `APPEAL_WINDOW`.
   * Round 3, or any round that produces an INVALID verdict -> final.
6. **Appeal** - the round loser may call `appealDispute(id)` paying the next
   tier's fee. The dispute is re-queued with the previous panel cleared
   (commits, reveals, and votes wiped).
7. **Finalize** - when the appeal window expires without an appeal, anyone
   calls `finalizeJuryRound(id)` again to lock in the verdict and pay out:
   * Winner gets the full pot. Loser eats `recordLoss` + `recordDisputeLoss`.
   * The fee pool (escalation fees + slashed stakes) is split equally among
     majority jurors of the final round.
   * **INVALID verdict**: both stakes are refunded *and* the fee pool is split
     50/50 between the participants - escalators are not punished for an
     inconclusive jury.

**Why commit-reveal.** Plaintext on-chain voting lets every juror after the
first read previous jurors' votes from the transaction log and copy the
plurality, which collapses the Schelling-point design into a "vote-with-the-
first-mover" Nash equilibrium. By splitting voting into a hidden commit phase
followed by a forced-disclosure reveal phase, the contract guarantees that no
juror can see anyone else's vote *before they commit their own*. A juror who
commits then refuses to reveal is treated identically to a minority voter
(loses `SLASH_AMOUNT`), which prevents selective disclosure as an attack.

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
| `/create` | Create a duel: title + long-form description, ETH ↔ USD stake toggle, stake-ratio presets, three datetime pickers (voting opens / vote deadline / resolution deadline). |
| `/jury` | Stake as juror, see queue, claim disputes, **commit** votes (salt is generated client-side and stored in localStorage). When the reveal phase opens and the juror returns to the page, the frontend **auto-reveals** without a second click. Anyone else with the salt can also reveal - the contract is permissionless. Finalize round once the reveal phase ends. |
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
  PredictionDuel.test.ts  77 tests covering the full flow
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
npm test                   # mocha + solidity tests (101 tests)
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
| `test/PredictionDuel.test.ts` | 77 | 97.08 % statements |
| `test/DuelReputation.test.ts` | 24 | 100.00 % statements |
| **Total** | **101** | - |

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
4. **3-tier Kleros-style jury starting at a single arbiter** - round 1 has a
   1-juror panel for fast / cheap resolution of clear-cut cases; appeals
   escalate to 3 jurors, then 5, with 1× / 3× / 9× fees. Round losers
   self-fund honest jurors, and the fee pool is split exactly among the
   majority of the final round only.
5. **Commit-reveal voting with binding hashes and *permissionless reveal*** -
   jurors call `commitJuryVote(id, keccak256(abi.encode(duelId, juror, vote,
   salt)))` during a 24h commit phase. The reveal that follows is callable
   by *anyone* with the matching `(juror, vote, salt)`. Tying the hash to
   `(duelId, juror)` blocks both cross-duel replay and address-substitution
   attacks (no third party can reveal a vote the juror did not commit), so
   `msg.sender` does not need to equal the juror. The juror therefore signs
   only one wallet transaction; the reveal can be delivered by the juror
   returning to the site (browser auto-reveal), by a public relayer, or by
   any third party who learns the salt. Non-revealers are slashed
   identically to minority voters, so withholding the salt is not a
   strategy. This is the single biggest deviation from textbook Kleros: it
   collapses the "see-and-copy" attack surface that plaintext voting leaves
   open *and* removes the "I forgot to reveal" UX trap.
6. **INVALID verdict refunds the fee pool 50/50** - escalators aren't
   punished for an inconclusive jury, which Kleros leaves underspecified.
7. **`cancelStaleDispute` safety valve** - if both parties go quiet during a
   dispute, anyone can force a refund after `ESCALATION_GRACE`. Funds never
   permanently lock.
8. **Counterfactual two-contract deploy** - `DuelReputation.duelContract` is
   `immutable`, so once deployed the cross-reference can't be re-pointed.
9. **Pull-payment everywhere** - winner credit, refunds, juror rewards, even
   the INVALID-verdict fee refund all flow through `pendingWithdrawals`. A
   wallet that rejects ETH cannot grief its counterparty.

## 10. Security awareness

* **Reentrancy** - `nonReentrant` on every payable function and on `withdraw`.
  Tested with a malicious receiver (`mocks/ReentrantAttacker.sol`).
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
- **The two-tx UX trap dissolves once you make reveal permissionless.**
  The first version of `revealJuryVote` required `msg.sender == juror`,
  which forced jurors to remember to come back during the reveal window or
  forfeit their stake. We initially rationalised this as "well, that's how
  commit-reveal works." It isn't. The hash binding `keccak256(abi.encode(
  duelId, juror, vote, salt))` already prevents anyone but the juror from
  knowing valid `(vote, salt)` pairs, so dropping the `msg.sender` check is
  free security-wise and lets a relayer / browser auto-reveal / friendly
  bot deliver the reveal tx. The juror signs **one** wallet popup; the
  reveal can come from anywhere. Test 48f explicitly verifies a third
  party (`charlie`, not on the panel) successfully revealing all three
  jurors' votes given salts.

## 12. Known limitations

* **Juror selection is self-service.** `claimDispute()` lets any staked juror
  pick up the queue's front. With enough capital a single actor could pack a
  panel; a future hardening would draw jurors with on-chain randomness
  (Chainlink VRF) or a stake-weighted lottery.
* **Salt is held in the juror's browser between commit and reveal.** The
  contract is fully on-chain and the reveal itself is permissionless, but
  the salt that lets *anyone* call reveal lives in the juror's
  `localStorage` until `revealJuryVote` consumes it. A juror who commits
  from a private window, then clears site data, then never returns, also
  never reveals - and is slashed. The frontend auto-reveals on the next
  visit during the reveal window so the common case is a single click; for
  set-and-forget UX the juror would need to post `(vote, salt)` to a public
  relayer (not implemented; `vercel.json` already supports a function route
  if we wanted one).
* **Lock-up during a round.** Once a juror calls `claimDispute`, their
  stake is locked on that dispute (`lockedOnDispute`) until
  `finalizeJuryRound` completes - typically 48h commit+reveal plus up to
  24h appeal window. This is intrinsic to stake-at-risk jury design (the
  stake must be slashable), not a quirk of commit-reveal: a single-tx vote
  scheme would lock the juror identically. A future improvement would let
  jurors reserve only `SLASH_AMOUNT` per active dispute and serve multiple
  panels in parallel, but it requires accounting for cumulative slash
  exposure.
* **Disputed duels need someone to escalate.** If neither party pays
  `DISPUTE_FEE`, the duel sits in DISPUTED until `ESCALATION_GRACE`, at which
  point `cancelStaleDispute` refunds both sides.
* **Integer-division dust** in juror reward distribution stays in the
  contract. With a 5-juror final round this is at most 4 wei per dispute.
* **No subjective question moderation.** A creator can post a malformed or
  ambiguous question; the only recourse is for both parties to vote INVALID
  or for jurors to do so.

Given more time we would: draw jurors via Chainlink VRF (closes the
panel-packing surface), add an L2 deployment for cheaper jury participation,
and build a Subgraph so the frontend can paginate historic duels without
scanning storage.

## 13. Conclusion

PredictionDuel is a deliberately small protocol with a deliberately
opinionated design. The interesting work isn't "yes/no bets on chain" - that's
trivial - it's the *resolution side*: asymmetric stakes encoded as payoff
asymmetry, soulbound reputation that can't be transferred or wash-traded
profitably, and a 3-tier (1 -> 3 -> 5 juror) commit-reveal jury whose fees
self-balance honest behaviour. We were able to build it, test it
(97 % / 100 % coverage, **101 tests**, including explicit failure cases,
commit-reveal-specific attacks, a permissionless-reveal third-party scenario,
and a reentrancy attacker), deploy and verify it on Sepolia, and drive every
advertised user flow end-to-end through the frontend.

Things we'd build next:
1. VRF-based juror draw (closes the panel-packing attack surface).
2. Mobile-first PWA shell with WalletConnect deep links.