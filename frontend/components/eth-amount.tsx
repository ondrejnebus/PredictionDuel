"use client";

import { formatEther } from "viem";
import { useEthPrice } from "@/lib/use-eth-price";
import { fmtEth } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Renders a wei amount as `0.5 ETH ≈ $1,750` with the USD figure faded.
/// USD value is hidden while the price is loading (or fetch failed).
export function EthAmount({
  wei,
  className,
  hideUsd,
  bold,
}: {
  wei: bigint;
  className?: string;
  hideUsd?: boolean;
  bold?: boolean;
}) {
  const { data: price } = useEthPrice();
  const eth = Number(formatEther(wei));
  const usd = price ? eth * price : null;
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className={bold ? "font-semibold tabular-nums" : "font-mono"}>
        {fmtEth(wei)} ETH
      </span>
      {!hideUsd && usd !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          ≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      )}
    </span>
  );
}
