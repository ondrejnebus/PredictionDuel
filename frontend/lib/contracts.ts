import { predictionDuelAbi } from "./abis/predictionDuel";
import { duelReputationAbi } from "./abis/duelReputation";

/// Sepolia deployment (see ../../deployments/sepolia.json).
export const PREDICTION_DUEL_ADDRESS =
  (process.env.NEXT_PUBLIC_PREDICTION_DUEL_ADDRESS as `0x${string}` | undefined) ??
  "0x34e27a22f82aCBBEA6672627B3C8c8AF006733C4";

export const DUEL_REPUTATION_ADDRESS =
  (process.env.NEXT_PUBLIC_DUEL_REPUTATION_ADDRESS as `0x${string}` | undefined) ??
  "0x8E351b767e54CE32dEbd6fBD7d456d50eAEcB595";

export const predictionDuel = {
  address: PREDICTION_DUEL_ADDRESS,
  abi: predictionDuelAbi,
} as const;

export const duelReputation = {
  address: DUEL_REPUTATION_ADDRESS,
  abi: duelReputationAbi,
} as const;

/// Helper: chain id we expect to be connected to. Defaults to Sepolia.
export const TARGET_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111,
);
