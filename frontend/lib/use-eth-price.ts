"use client";

import { useQuery } from "@tanstack/react-query";

async function fetchEthUsd(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ETH price fetch failed: HTTP ${res.status}`);
  const json = (await res.json()) as { ethereum: { usd: number } };
  return json.ethereum.usd;
}

/// Returns the spot ETH/USD price, refreshed every 60s.
export function useEthPrice() {
  return useQuery({
    queryKey: ["ethUsd"],
    queryFn: fetchEthUsd,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
