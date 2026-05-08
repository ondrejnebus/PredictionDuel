"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TARGET_CHAIN_ID } from "@/lib/contracts";

/// Renders children only when the user is connected and on the right chain.
/// Otherwise shows the appropriate prompt.
export function ChainGuard({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Connect a wallet to continue.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (chainId !== TARGET_CHAIN_ID) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Wrong network. Switch to <strong>Sepolia</strong> to continue.
          </p>
          <Button
            disabled={isPending}
            onClick={() => switchChain({ chainId: sepolia.id })}
          >
            {isPending ? "Switching…" : "Switch to Sepolia"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
