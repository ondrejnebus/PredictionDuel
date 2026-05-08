export const predictionDuelAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "reputationAddr",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadySettled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyVoted",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AppealWindowExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AppealWindowStillOpen",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CreatorCannotAccept",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DisputeAlreadyFinalized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DisputeAlreadyInitialized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DisputeNotInitialized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DuelNotDisputed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DuelNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyQuestion",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EscalationGraceNotReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientJurorStake",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientReputation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidDeadlines",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidOutcome",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPagination",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JurorAlreadyLocked",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JurorIsParticipant",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxRoundsReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoAppealWindow",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoDisputesInQueue",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotAJuror",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotActiveOrVoting",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotCreatedStatus",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotEligibleJuror",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotParticipant",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotRoundLoser",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NothingToWithdraw",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyCreator",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ResolutionDeadlineNotReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VoteDeadlineNotReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VotingClosed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VotingNotStarted",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VotingPeriodNotOver",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "WrongDisputeFee",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "WrongStakeAmount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroStake",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "round",
        "type": "uint8"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "initiator",
        "type": "address"
      }
    ],
    "name": "DisputeEscalated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "verdict",
        "type": "uint8"
      }
    ],
    "name": "DisputeFinalized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "opponent",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "opponentOutcome",
        "type": "uint8"
      }
    ],
    "name": "DuelAccepted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "refund",
        "type": "uint256"
      }
    ],
    "name": "DuelCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "creatorOutcome",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "creatorStake",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "opponentStake",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "minOpponentReputation",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "voteDeadline",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "resolutionDeadline",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "question",
        "type": "string"
      }
    ],
    "name": "DuelCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "DuelDisputed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "creatorRefund",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "opponentRefund",
        "type": "uint256"
      }
    ],
    "name": "DuelRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "winner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "payout",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "consensus",
        "type": "uint8"
      }
    ],
    "name": "DuelSettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "juror",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "round",
        "type": "uint8"
      }
    ],
    "name": "JurorClaimedDispute",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "juror",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "JurorRewarded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "juror",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "JurorSlashed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "juror",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "JurorStaked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "juror",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "JurorUnstaked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "juror",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "vote",
        "type": "uint8"
      }
    ],
    "name": "JurorVoted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "round",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "majority",
        "type": "uint8"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "roundLoser",
        "type": "address"
      }
    ],
    "name": "RoundResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "voter",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum PredictionDuel.Outcome",
        "name": "vote",
        "type": "uint8"
      }
    ],
    "name": "VoteSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Withdrawn",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "APPEAL_WINDOW",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DISPUTE_FEE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ESCALATION_GRACE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "JUROR_STAKE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SLASH_AMOUNT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "VOTING_PERIOD",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "acceptDuel",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      }
    ],
    "name": "appealDispute",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "cancelDuel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      }
    ],
    "name": "cancelStaleDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "question",
        "type": "string"
      },
      {
        "internalType": "enum PredictionDuel.Outcome",
        "name": "creatorOutcome",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "opponentStake",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minOpponentReputation",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "voteDeadline",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "resolutionDeadline",
        "type": "uint64"
      }
    ],
    "name": "createDuel",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "duelCounter",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      }
    ],
    "name": "escalateToJury",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      }
    ],
    "name": "finalizeJuryRound",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "offset",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "getActiveDisputes",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "result",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "offset",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "getActiveDuels",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "id",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "creator",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "opponent",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "creatorStake",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "opponentStake",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minOpponentReputation",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "voteDeadline",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "resolutionDeadline",
            "type": "uint64"
          },
          {
            "internalType": "enum PredictionDuel.Status",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "creatorOutcome",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "opponentOutcome",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "creatorVote",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "opponentVote",
            "type": "uint8"
          },
          {
            "internalType": "string",
            "name": "question",
            "type": "string"
          }
        ],
        "internalType": "struct PredictionDuel.Duel[]",
        "name": "result",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      }
    ],
    "name": "getDisputeData",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "round",
        "type": "uint8"
      },
      {
        "internalType": "enum PredictionDuel.Outcome",
        "name": "lastRoundOutcome",
        "type": "uint8"
      },
      {
        "internalType": "address[]",
        "name": "selectedJurors",
        "type": "address[]"
      },
      {
        "internalType": "uint64",
        "name": "votingDeadline",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "appealDeadline",
        "type": "uint64"
      },
      {
        "internalType": "address",
        "name": "round1Loser",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "round2Loser",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "feePool",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "initialized",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "finalized",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getDisputeQueueLength",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getDuel",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "id",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "creator",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "opponent",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "creatorStake",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "opponentStake",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minOpponentReputation",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "voteDeadline",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "resolutionDeadline",
            "type": "uint64"
          },
          {
            "internalType": "enum PredictionDuel.Status",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "creatorOutcome",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "opponentOutcome",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "creatorVote",
            "type": "uint8"
          },
          {
            "internalType": "enum PredictionDuel.Outcome",
            "name": "opponentVote",
            "type": "uint8"
          },
          {
            "internalType": "string",
            "name": "question",
            "type": "string"
          }
        ],
        "internalType": "struct PredictionDuel.Duel",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getDuelistReputation",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "wins",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "losses",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "disputesInitiated",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "disputesWon",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "disputesLost",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "noShowCount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalVolumeWei",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "winPointsAccum",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "noShowPenaltyAccum",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "lastActivityAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct DuelReputation.Reputation",
        "name": "rep",
        "type": "tuple"
      },
      {
        "internalType": "int256",
        "name": "score",
        "type": "int256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "juror",
        "type": "address"
      }
    ],
    "name": "getJurorInfo",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "stake",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "lockedOnDispute",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getNextDispute",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getUserDuels",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duelId",
        "type": "uint256"
      },
      {
        "internalType": "enum PredictionDuel.Outcome",
        "name": "vote",
        "type": "uint8"
      }
    ],
    "name": "juryVote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "pendingWithdrawals",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "reputation",
    "outputs": [
      {
        "internalType": "contract DuelReputation",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "settleDuel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "stakeAsJuror",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "enum PredictionDuel.Outcome",
        "name": "vote",
        "type": "uint8"
      }
    ],
    "name": "submitVote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "unstakeAsJuror",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdraw",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
