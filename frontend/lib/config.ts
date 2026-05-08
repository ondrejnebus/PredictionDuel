"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "viem";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

// RainbowKit requires a non-empty projectId. If the user hasn't set one yet
// we fall back to a 32-char placeholder so the config still constructs and
// the dApp loads - only WalletConnect-based wallets will be unusable until
// a real id is set. Get a free id at https://cloud.reown.com/.
const PLACEHOLDER_PROJECT_ID = "00000000000000000000000000000000";
const projectId =
  (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim() ||
  PLACEHOLDER_PROJECT_ID;

export const wagmiConfig = getDefaultConfig({
  appName: "PredictionDuel",
  projectId,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(rpcUrl),
  },
  ssr: true,
});
