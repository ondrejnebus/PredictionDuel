# PredictionDuel

Trustless peer-to-peer wagers on a yes/no outcome. The creator stakes ETH and
picks the stake the opponent must match - typically asymmetric, so the favoured
side risks more to win less. After both parties have voted on what actually
happened, the contract settles automatically. If they disagree, a Kleros-style
jury panel resolves the dispute. Every settled duel updates a soulbound
on-chain reputation NFT.

Built on **Hardhat 3** + TypeScript + **ethers v6** + **Solidity 0.8.35**.

## Contracts

| Contract | Purpose | Bytecode |
|---|---|---|
| `PredictionDuel.sol` | Wager lifecycle, voting, settlement, jury dispute resolution | ~13 KB |
| `DuelReputation.sol` | Soulbound ERC-721 reputation tracker (one token per address) | ~8 KB |
| `mocks/ReentrantAttacker.sol` | Test-only contract used to verify CEI / `nonReentrant` on `withdraw()` | - |

Both production contracts compile with the optimizer (`runs: 200`) and
`viaIR: true`.

## Lifecycle

* `createDuel` - creator stakes `msg.value`, sets the opponent's required stake,
  the bet outcome (YES/NO), an optional `minOpponentReputation` gate, a
  `voteDeadline`, and a `resolutionDeadline`.
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

## Reputation (DuelReputation)

* Token id is deterministic: `tokenId = uint256(uint160(addr))`. One NFT per
  address, soulbound (`_update` reverts when both `from` and `to` are non-zero).
* Lazy-minted on the first record event for that address.
* Score = `decayed_winPoints + (disputesWon × 1) − (disputesLost × 10)
         − noShowPenaltyAccum`.
* Win points are stake-weighted: `2 + log2(stake / 0.001 ETH)`, so a 1 ETH win
  is worth 11 points and a 0.001 ETH wash-trade is worth 2.
* No-show penalty is `max(10, currentScore / 5)` so high-rep accounts cannot
  shrug off a no-show.
* Positive reputation halves every 365 days of inactivity (capped at 30
  halvings). Negative reputation never decays.
* `tokenURI` returns inline base64 JSON metadata with all counters as traits.

## Jury dispute resolution

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
| 1 | 3 | 1× `DISPUTE_FEE` (0.01 ETH) |
| 2 | 5 | 3× (0.03 ETH) |
| 3 | 7 | 9× (0.09 ETH) |

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
6. **Finalize** - when the appeal window expires without an appeal, anyone calls
   `finalizeJuryRound(id)` again to lock in the verdict and pay out:
   * Winner gets the full pot. Loser eats `recordLoss` + `recordDisputeLoss`.
   * The fee pool (escalation fees + slashed stakes) is split equally among
     majority jurors of the final round.
   * **INVALID verdict**: both stakes are refunded *and* the fee pool is split
     50/50 between the participants - escalators are not punished for an
     inconclusive jury.

**Stuck disputes** - `cancelStaleDispute(id)` lets anyone refund a duel that
has been DISPUTED for longer than `ESCALATION_GRACE` past `resolutionDeadline`
without anyone escalating. Funds never permanently lock.

## Project layout

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
hardhat.config.ts         Hardhat 3 config (ESM)
tsconfig.json             TypeScript (ESM, node16)
```

## Setup

```bash
npm install
cp .env.example .env # then fill in values for non-local networks
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

`configVariable(...)` resolves from the keystore first, then `process.env`.

## Build & test

```bash
npm run compile                    # hardhat compile
npm test                           # mocha + solidity tests (96 tests)
npm run coverage                   # hardhat test --coverage (built-in to HH3)
npm run test:gas                   # hardhat test --gas-stats
npm run clean                      # hardhat clean
```

Latest coverage: **PredictionDuel 97.08% / DuelReputation 100.00%**.

## Deployment

`PredictionDuel` and `DuelReputation` reference each other in their
constructors, and `DuelReputation.duelContract` is `immutable`. The deploy
script uses the **counterfactual** pattern - predict PredictionDuel's CREATE
address from the deployer's nonce, deploy DuelReputation with that address,
then deploy PredictionDuel - so both end up linked without a setter that could
be re-pointed later.

```bash
# Local dry run
npx hardhat node                                          # in another terminal
npx hardhat run scripts/deploy.ts --network localhost

# Sepolia
npx hardhat run scripts/deploy.ts   --network sepolia
npx hardhat run scripts/verify.ts   --network sepolia     # Etherscan verification
npx hardhat run scripts/interact.ts --network sepolia     # creates a 0.001 ETH duel
```

The deploy script writes addresses, constructor args, and tx hashes to
`deployments/<network>.json`, which `verify.ts` and `interact.ts` then read.

## Networks

* `hardhat` - in-process EDR-simulated L1 (default for tests)
* `localhost` - connects to a `npx hardhat node` instance at `127.0.0.1:8545`
* `sepolia` - public Ethereum testnet via `SEPOLIA_RPC_URL` and `PRIVATE_KEY`

## Hardhat 3 notes

* The project is **ESM** (`"type": "module"`). Config and scripts use `import`.
* `solidity-coverage` is **not** used; HH3 ships native coverage via the
  global `--coverage` flag.
* Plugins are registered through the `plugins: [...]` array in `defineConfig`.
* Networks declare a `type` (`edr-simulated` / `http`) and a `chainType`
  (`l1` / `op`).
* Etherscan verification uses a single Etherscan v2 `apiKey`.

## Known limitations

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
* **Integer-division dust** in juror reward distribution stays in the contract.
  With a 7-juror final round this is at most 6 wei per dispute.