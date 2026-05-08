"use client";

import { use } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { toast } from "sonner";
import { parseEther } from "viem";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EthAmount } from "@/components/eth-amount";
import { useTxToast } from "@/components/tx-status";
import {
  fmtDeadline,
  fmtEth,
  Outcome,
  outcomeLabel,
  shortAddr,
  Status,
  timeUntil,
  explainError,
} from "@/lib/format";
import { predictionDuel } from "@/lib/contracts";
import type { DuelView } from "@/components/duel-card";

export default function DuelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const duelId = BigInt(id);

  const { address } = useAccount();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useReadContract({
    ...predictionDuel,
    functionName: "getDuel",
    args: [duelId],
  });

  const duel = data as DuelView | undefined;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Duel #{id}</span>
          {duel && <StatusBadge status={duel.status} />}
        </div>
        {isLoading && <Skeleton className="h-10 w-3/4" />}
        {duel && (
          <h1 className="text-2xl font-semibold tracking-tight">
            {duel.question}
          </h1>
        )}
      </header>

      {isError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Could not load this duel: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {duel && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Stakes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  k="Creator"
                  v={shortAddr(duel.creator)}
                  hint={`bet ${outcomeLabel[duel.creatorOutcome]}`}
                />
                <Row
                  k="Opponent"
                  v={
                    duel.opponent === "0x0000000000000000000000000000000000000000"
                      ? "-"
                      : shortAddr(duel.opponent)
                  }
                  hint={
                    duel.status >= Status.ACTIVE
                      ? `bet ${outcomeLabel[duel.opponentOutcome]}`
                      : "open"
                  }
                />
                <RowEth k="Creator stake" wei={duel.creatorStake} />
                <RowEth k="Opponent stake" wei={duel.opponentStake} />
                <RowEth
                  k="Total pot"
                  wei={duel.creatorStake + duel.opponentStake}
                  bold
                />
                {duel.minOpponentReputation > 0n && (
                  <Row
                    k="Min opponent reputation"
                    v={duel.minOpponentReputation.toString()}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row
                  k="Vote deadline"
                  v={fmtDeadline(duel.voteDeadline)}
                  hint={`(${timeUntil(duel.voteDeadline)})`}
                />
                <Row
                  k="Resolution deadline"
                  v={fmtDeadline(duel.resolutionDeadline)}
                  hint={`(${timeUntil(duel.resolutionDeadline)})`}
                />
                <Row
                  k="Creator vote"
                  v={outcomeLabel[duel.creatorVote] ?? "-"}
                />
                <Row
                  k="Opponent vote"
                  v={outcomeLabel[duel.opponentVote] ?? "-"}
                />
              </CardContent>
            </Card>
          </div>

          <Actions
            duel={duel}
            me={address}
            duelId={duelId}
            onChange={() => refetch()}
          />
        </>
      )}
    </div>
  );
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-muted-foreground">{k}</div>
      <div className="text-right">
        <div className="font-mono">{v}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

function RowEth({ k, wei, bold }: { k: string; wei: bigint; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-muted-foreground">{k}</div>
      <EthAmount wei={wei} bold={bold} className="text-right" />
    </div>
  );
}

function Actions({
  duel,
  me,
  duelId,
  onChange,
}: {
  duel: DuelView;
  me: `0x${string}` | undefined;
  duelId: bigint;
  onChange: () => void;
}) {
  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Submitting transaction…",
    successMsg: "Transaction confirmed",
    onSuccess: onChange,
  });

  const isCreator = me && me.toLowerCase() === duel.creator.toLowerCase();
  const isOpponent =
    me &&
    duel.opponent !== "0x0000000000000000000000000000000000000000" &&
    me.toLowerCase() === duel.opponent.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const votingOpen = now < Number(duel.voteDeadline);

  // wagmi's writeContract has a discriminated-union arg type per functionName,
  // which TS can't narrow when called through a generic helper. We loosen the
  // type here; runtime validation still happens inside wagmi.
  type AnyWriteArgs = Parameters<typeof writeContract>[0];
  const send = (label: string, args: AnyWriteArgs | unknown) => {
    try {
      writeContract(args as AnyWriteArgs);
    } catch (e) {
      toast.error(`${label} failed`, { description: explainError(e) });
    }
  };

  //  CREATED: opponent can accept; creator can cancel 
  if (duel.status === Status.CREATED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Available actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!me && <p className="text-sm text-muted-foreground">Connect a wallet to act.</p>}
          {me && !isCreator && (
            <Button
              disabled={isPending || !votingOpen}
              onClick={() =>
                send("Accept", {
                  ...predictionDuel,
                  functionName: "acceptDuel",
                  args: [duelId],
                  value: duel.opponentStake,
                })
              }
            >
              Accept duel · stake&nbsp;
              <EthAmount wei={duel.opponentStake} hideUsd />
              &nbsp;· bet {duel.creatorOutcome === Outcome.YES ? "NO" : "YES"}
            </Button>
          )}
          {isCreator && (
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                send("Cancel", {
                  ...predictionDuel,
                  functionName: "cancelDuel",
                  args: [duelId],
                })
              }
            >
              Cancel duel
            </Button>
          )}
          {!votingOpen && (
            <p className="text-sm text-muted-foreground">
              Vote deadline already passed - this duel is no longer acceptable.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  //  ACTIVE / VOTING: participants vote, then anyone can settle 
  if (duel.status === Status.ACTIVE || duel.status === Status.VOTING) {
    const myVote = isCreator
      ? duel.creatorVote
      : isOpponent
        ? duel.opponentVote
        : Outcome.NONE;
    const canVote = (isCreator || isOpponent) && myVote === Outcome.NONE && votingOpen;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Available actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {canVote &&
            ([Outcome.YES, Outcome.NO, Outcome.INVALID] as const).map((o) => (
              <Button
                key={o}
                variant={
                  o === Outcome.INVALID ? "outline" : o === Outcome.YES ? "success" : "secondary"
                }
                disabled={isPending}
                onClick={() =>
                  send(`Vote ${outcomeLabel[o]}`, {
                    ...predictionDuel,
                    functionName: "submitVote",
                    args: [duelId, o],
                  })
                }
              >
                Vote {outcomeLabel[o]}
              </Button>
            ))}
          {(isCreator || isOpponent) && myVote !== Outcome.NONE && (
            <p className="text-sm text-muted-foreground">
              You voted <strong>{outcomeLabel[myVote]}</strong>.
            </p>
          )}
          {!votingOpen && (
            <Button
              variant="default"
              disabled={isPending}
              onClick={() =>
                send("Settle", {
                  ...predictionDuel,
                  functionName: "settleDuel",
                  args: [duelId],
                })
              }
            >
              Settle duel
            </Button>
          )}
          {!isCreator && !isOpponent && votingOpen && (
            <p className="text-sm text-muted-foreground">
              Voting is open. Only participants can vote.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  //  DISPUTED: anyone can escalate to jury (or refund stale ones) 
  if (duel.status === Status.DISPUTED) {
    const graceOver = now >= Number(duel.resolutionDeadline) + 7 * 24 * 60 * 60;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dispute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The two parties voted differently. Either side can pay 0.01 ETH to
            escalate to a 3-juror panel. After {graceOver ? "the 7-day grace period (now elapsed)" : "7 days past resolution"} anyone may force-refund both stakes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isPending}
              onClick={() =>
                send("Escalate", {
                  ...predictionDuel,
                  functionName: "escalateToJury",
                  args: [duelId],
                  value: parseEther("0.01"),
                })
              }
            >
              Escalate to jury (0.01 ETH)
            </Button>
            {graceOver && (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  send("Refund stale dispute", {
                    ...predictionDuel,
                    functionName: "cancelStaleDispute",
                    args: [duelId],
                  })
                }
              >
                Force-refund stuck dispute
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  //  SETTLED / CANCELLED: read-only summary 
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          This duel is{" "}
          <strong className="text-foreground">
            {duel.status === Status.SETTLED ? "settled" : "cancelled"}
          </strong>
          . Any pending balance can be claimed from your{" "}
          <a href="/profile" className="text-primary underline-offset-4 hover:underline">
            profile
          </a>{" "}
          page.
        </p>
      </CardContent>
    </Card>
  );
}
