import { formatEther } from "viem";

export const Status = {
  CREATED: 0,
  ACTIVE: 1,
  VOTING: 2,
  DISPUTED: 3,
  SETTLED: 4,
  CANCELLED: 5,
} as const;

export type StatusValue = (typeof Status)[keyof typeof Status];

export const statusLabel: Record<number, string> = {
  0: "Open",
  1: "Active",
  2: "Voting",
  3: "Disputed",
  4: "Settled",
  5: "Cancelled",
};

export const Outcome = {
  NONE: 0,
  YES: 1,
  NO: 2,
  INVALID: 3,
} as const;

export type OutcomeValue = (typeof Outcome)[keyof typeof Outcome];

export const outcomeLabel: Record<number, string> = {
  0: "-",
  1: "YES",
  2: "NO",
  3: "INVALID",
};

export function fmtEth(wei: bigint, fractionDigits = 4): string {
  const n = Number(formatEther(wei));
  if (Number.isNaN(n)) return "0";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
  });
}

export function shortAddr(addr?: string): string {
  if (!addr) return "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtDeadline(secs: bigint | number): string {
  const d = new Date(Number(secs) * 1000);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

export function timeUntil(secs: bigint | number): string {
  const target = Number(secs) * 1000;
  const delta = target - Date.now();
  if (delta <= 0) return "expired";
  const m = Math.floor(delta / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

/// Parse a chain error into something a human can read.
export function explainError(err: unknown): string {
  if (!err) return "Unknown error";
  // viem ContractFunctionExecutionError surfaces shortMessage + name
  const anyErr = err as {
    shortMessage?: string;
    message?: string;
    cause?: { shortMessage?: string; reason?: string };
    details?: string;
  };
  return (
    anyErr.cause?.shortMessage ||
    anyErr.cause?.reason ||
    anyErr.shortMessage ||
    anyErr.details ||
    anyErr.message ||
    "Transaction failed"
  );
}
