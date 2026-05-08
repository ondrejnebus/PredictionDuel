"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { Toaster } from "sonner";
import "@rainbow-me/rainbowkit/styles.css";

import { wagmiConfig } from "@/lib/config";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 12_000, // ~one Sepolia block
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "hsl(256, 88%, 66%)",
            accentColorForeground: "white",
            borderRadius: "medium",
          })}
          modalSize="compact"
        >
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{ classNames: { toast: "rounded-md" } }}
          />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
