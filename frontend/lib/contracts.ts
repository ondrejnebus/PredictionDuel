import { predictionDuelAbi } from "./abis/predictionDuel";
import { duelReputationAbi } from "./abis/duelReputation";

/// Sepolia deployment (see ../../deployments/sepolia.json).
export const PREDICTION_DUEL_ADDRESS =
  (process.env.NEXT_PUBLIC_PREDICTION_DUEL_ADDRESS as `0x${string}` | undefined) ??
  "0x251968A3BF080AA888609Aa2114DB9fC017fd84A";

export const DUEL_REPUTATION_ADDRESS =
  (process.env.NEXT_PUBLIC_DUEL_REPUTATION_ADDRESS as `0x${string}` | undefined) ??
  "0xa7E719C61CC259739B025E07f1785d455f5Bc0b6";

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
