"use client";

import { encodeAbiParameters, keccak256 } from "viem";

/// Local-storage record of a juror's pending commit so they can reveal later.
/// Keyed by `${chainId}:${duelId}:${jurorAddress}` to avoid cross-network leaks.
export type CommitRecord = {
  duelId: string;
  juror: `0x${string}`;
  vote: number; // Outcome (1=YES, 2=NO, 3=INVALID)
  salt: `0x${string}`;
  hash: `0x${string}`;
  committedAt: number; // unix seconds
};

const KEY_PREFIX = "predictionduel:commit:";

function keyFor(duelId: bigint | string, juror: string): string {
  return `${KEY_PREFIX}${String(duelId).toLowerCase()}:${juror.toLowerCase()}`;
}

/// Generate a 32-byte salt using the Web Crypto API.
export function randomSalt(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return ("0x" +
    Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

/// Compute the on-chain commit hash. Mirrors PredictionDuel.computeVoteCommit:
///   keccak256(abi.encode(uint256 duelId, address juror, uint8 vote, bytes32 salt))
export function computeCommitHash(
  duelId: bigint,
  juror: `0x${string}`,
  vote: number,
  salt: `0x${string}`,
): `0x${string}` {
  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "uint8" },
      { type: "bytes32" },
    ],
    [duelId, juror, vote, salt],
  );
  return keccak256(data);
}

export function saveCommit(rec: CommitRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(rec.duelId, rec.juror), JSON.stringify(rec));
  } catch {
    // ignore quota / private-mode failures
  }
}

export function loadCommit(
  duelId: bigint | string,
  juror: `0x${string}`,
): CommitRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(duelId, juror));
    if (!raw) return null;
    return JSON.parse(raw) as CommitRecord;
  } catch {
    return null;
  }
}

export function clearCommit(
  duelId: bigint | string,
  juror: `0x${string}`,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(duelId, juror));
  } catch {
    // ignore
  }
}