"use client";

import Link from "next/link";
import { useReadContract } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { DuelCard, type DuelView } from "@/components/duel-card";
import { predictionDuel } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export default function BrowseDuels() {
  const { data, isLoading, error } = useReadContract({
    ...predictionDuel,
    functionName: "getActiveDuels",
    args: [0n, 50n],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Open & active duels</h1>
          <p className="text-sm text-muted-foreground">
            Pick one to accept, watch, or settle. Settled and cancelled duels are hidden.
          </p>
        </div>
        <Link
          href="/create"
          className={cn(buttonVariants({ variant: "default" }))}
        >
          New duel
        </Link>
      </div>

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load duels: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}

      {!isLoading && Array.isArray(data) && data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No active duels. Be the first to{" "}
            <Link href="/create" className="text-primary underline-offset-4 hover:underline">
              create one
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {!isLoading && Array.isArray(data) && data.length > 0 && (
        <div className="grid gap-3">
          {(data as readonly DuelView[]).map((d) => (
            <DuelCard key={d.id.toString()} duel={d} />
          ))}
        </div>
      )}
    </div>
  );
}
