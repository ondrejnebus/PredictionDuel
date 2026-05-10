"use client";

import { useEffect, useState } from "react";

/// Re-renders every second so callers can use Date.now() to display a
/// live countdown without each component owning its own timer.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/// Format a deadline as a live ticking countdown ("1d 04h 12m 30s" / "expired").
export function formatCountdown(deadlineSec: bigint | number, now = Date.now()): string {
  const target = Number(deadlineSec) * 1000;
  let delta = target - now;
  if (delta <= 0) return "expired";

  const days = Math.floor(delta / 86_400_000);
  delta -= days * 86_400_000;
  const hours = Math.floor(delta / 3_600_000);
  delta -= hours * 3_600_000;
  const minutes = Math.floor(delta / 60_000);
  delta -= minutes * 60_000;
  const seconds = Math.floor(delta / 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}