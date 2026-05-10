# Architecture

This document supplements the high-level diagram in the project [README](../README.md).
All diagrams below use Mermaid; GitHub renders them inline.

## 1. Component diagram

```mermaid
flowchart TB
  subgraph FE["Frontend (Next.js 15 / wagmi v2 / viem)"]
    Pages["/, /duels, /duels/[id], /create, /jury, /profile"]
    Hooks["useTxToast · useNow · ChainGuard · commit-reveal lib"]
    ABI["lib/abis/* (typed `as const` ABIs)"]
  end

  subgraph Chain["Ethereum Sepolia"]
    PD["PredictionDuel.sol"]
    DR["DuelReputation.sol"]
  end

  Wallet["MetaMask / RainbowKit"]
  RPC["Sepolia RPC"]
  LS["Browser localStorage<br/>(salt + outcome between<br/>commit and reveal)"]

  Pages --> Hooks
  Hooks --> ABI
  Hooks <--> LS
  ABI -- "viem JSON-RPC" --> RPC
  Wallet -- "EIP-1193" --> Pages
  RPC --> PD
  RPC --> DR
  PD -- "recordWin / recordLoss / recordDispute*" --> DR
  PD -- "reads reputationScore (rep gate)" --> DR
```

## 2. Duel lifecycle (state machine)

```mermaid
stateDiagram-v2
  [*] --> CREATED: createDuel()
  CREATED --> CANCELLED: cancelDuel() (creator only)
  CREATED --> ACTIVE: acceptDuel() (matches stake)
  ACTIVE --> VOTING: submitVote() (first vote)
  VOTING --> VOTING: submitVote() (second vote)

  VOTING --> SETTLED: settleDuel(), votes agree
  VOTING --> SETTLED: settleDuel(), both INVALID (refund)
  VOTING --> SETTLED: settleDuel(), one no-show (solo voter wins)
  VOTING --> SETTLED: settleDuel(), both no-show after resolutionDeadline (refund + penalty)
  VOTING --> DISPUTED: settleDuel(), votes disagree

  ACTIVE --> SETTLED: settleDuel(), no-show paths after voteDeadline

  DISPUTED --> SETTLED: cancelStaleDispute() after ESCALATION_GRACE
  DISPUTED --> SETTLED: jury process (see jury diagram)
  SETTLED --> [*]
  CANCELLED --> [*]
```

Notes:
- Status transitions are one-way except for the `ACTIVE -> VOTING` step,
  which is a logical sub-state (both are accepted by `submitVote` and `settleDuel`).
- Every transition into `SETTLED` (whether via consensus, INVALID, no-show,
  jury verdict, or stale-dispute cancel) credits `pendingWithdrawals`. Funds
  are claimed by `withdraw()`.

## 3. Jury escalation state machine (with commit-reveal)

```mermaid
stateDiagram-v2
  [*] --> Disputed: settleDuel() with disagreeing votes
  Disputed --> Round1Queued: escalateToJury() pays DISPUTE_FEE
  Disputed --> Refunded: cancelStaleDispute() after 7 days
  Refunded --> [*]

  Round1Queued --> Commit: panel filled (round 1 = 1 juror; round 2 = 3; round 3 = 5)
  Commit --> Reveal: COMMIT_PERIOD ends
  Reveal --> Tallied: finalizeJuryRound() after REVEAL_PERIOD ends
  Tallied --> AppealWindow: round 1 or 2 verdict YES or NO
  Tallied --> Final: round 3 verdict OR INVALID at any round
  AppealWindow --> NextRound: appealDispute() within 24h
  AppealWindow --> Final: APPEAL_WINDOW expires

  NextRound --> Commit: panel cleared, larger size (3 then 5)

  Final --> [*]: pay winner / split fee pool to majority jurors
```

Per-round timing:

```
   t=0           t=+24h               t=+48h              t=+72h (max)
   |               |                    |                    |
   |--- commit ----|------ reveal ------|----- appeal -------|
   |               |                    |                    |
   panel filled,   commit closes,       reveal closes,       finalize() locks
   COMMIT_PERIOD   reveal opens,        finalize() tallies,  verdict if no
   opens           reveals validated    slashes minority +   appeal arrived
                                        non-revealers
```

Key rules embedded in the diagram:
- **Commit-reveal voting** - jurors submit
  `keccak256(abi.encode(duelId, juror, vote, salt))` during the commit phase;
  reveals are only accepted after the commit phase closes, so no juror can
  see another juror's vote before committing their own.
- **Non-revealers are slashed** identically to minority voters; selective
  disclosure is not a strategy.
- **Round 3 is always final.** No appeal beyond the 5-juror panel.
- **INVALID is always final** at any round (no Schelling point, no appeal).
- **Appeal fees compound (1× -> 3× -> 9×)** so frivolous appeals self-fund honest jurors.
- **Slashing** of `SLASH_AMOUNT` per minority juror or non-revealer happens
  on each round tally.

## 4. Settlement sequence (happy path)

```mermaid
sequenceDiagram
  participant A as Wallet A (creator)
  participant B as Wallet B (opponent)
  participant FE as Frontend
  participant PD as PredictionDuel
  participant DR as DuelReputation

  A->>FE: /create (question, stakes, deadlines)
  FE->>PD: createDuel{value: 0.04}(YES, 0.01, …)
  PD-->>FE: DuelCreated(id=1)
  B->>FE: /duels/1 -> Accept
  FE->>PD: acceptDuel{value: 0.01}(1)
  PD->>DR: reputationScore(B) (rep gate, optional)
  PD-->>FE: DuelAccepted(1, B, NO)

  Note over A,B: Event happens off-chain
  A->>PD: submitVote(1, YES)
  B->>PD: submitVote(1, YES)

  Note over PD: voteDeadline passes
  A->>PD: settleDuel(1)
  PD->>DR: recordWin(A, 0.04)
  PD->>DR: recordLoss(B, 0.01)
  PD-->>PD: pendingWithdrawals[A] += 0.05
  A->>PD: withdraw()
  PD-->>A: 0.05 ETH
```

## 5. Disputed sequence with commit-reveal (round 1 = single arbiter -> finalize)

```mermaid
sequenceDiagram
  participant A as Creator (bet YES)
  participant B as Opponent (bet NO)
  participant J as Round-1 Arbiter
  participant LS as J's localStorage
  participant PD as PredictionDuel

  Note over A,B: Voting window open
  A->>PD: submitVote(YES)
  B->>PD: submitVote(NO)
  Note over PD: voteDeadline passes
  PD->>PD: settleDuel -> status=DISPUTED

  A->>PD: escalateToJury{value: 0.01}(id)
  Note over PD: duel queued (round 1, panel size 1)

  J->>PD: stakeAsJuror{value: 0.05}
  J->>PD: claimDispute()
  Note over PD: panel full (1 juror) -> COMMIT_PERIOD opens

  Note over J,LS: salt = randomSalt()<br/>hash = keccak256(abi.encode(id, J, YES, salt))
  J->>LS: save {vote: YES, salt}
  J->>PD: commitJuryVote(id, hash)

  Note over PD: 24h pass -> REVEAL_PERIOD opens
  Note over J,LS: Reveal is PERMISSIONLESS:<br/>juror, relayer, browser auto-reveal,<br/>or any third party can submit
  J->>LS: read {vote, salt}
  J->>PD: revealJuryVote(id, J, YES, salt)

  Note over PD: 24h pass -> reveal closed
  A->>PD: finalizeJuryRound(id)
  PD->>PD: tally YES (1 juror = 1 vote, no minority to slash)
  PD->>PD: round1Loser = B (bet NO, lost)
  PD->>PD: appealDeadline = now + 24h

  alt bob accepts the verdict (no appeal)
    Note over PD: 24h pass without appeal
    A->>PD: finalizeJuryRound(id)
    PD->>PD: pay A the pot (0.05)
    PD->>PD: J gets the entire feePool (0.01 ETH)
    PD-->>PD: status=SETTLED
  else bob appeals to round 2 (3 jurors, 3x fee)
    B->>PD: appealDispute{value: 0.03}(id)
    Note over PD: panel cleared, queued for round 2 (size 3)
  end
```
