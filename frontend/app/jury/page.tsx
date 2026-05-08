"use client";

import Link from "next/link";
import { useReadContract, useWriteContract } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChainGuard } from "@/components/chain-guard";
import { useTxToast } from "@/components/tx-status";
import { predictionDuel } from "@/lib/contracts";
import { fmtDeadline, timeUntil } from "@/lib/format";

export default function JuryPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Jury</h1>
        <p className="text-sm text-muted-foreground">
          Stake to become a juror, claim disputes from the FIFO queue, and vote
          on outcomes. Vote with the majority or lose 0.02 ETH.
        </p>
      </header>
      <ChainGuard>
        <NextDispute />
        <ActiveDisputes />
      </ChainGuard>
    </div>
  );
}

function NextDispute() {
  const { data: queueLen } = useReadContract({
    ...predictionDuel,
    functionName: "getDisputeQueueLength",
  });
  const len = (queueLen as bigint | undefined) ?? 0n;
  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Claiming dispute…",
    successMsg: "Joined panel",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Queue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {len === 0n
            ? "No disputes are waiting for jurors right now."
            : `${len} dispute${len === 1n ? "" : "s"} waiting for jurors. Click claim to join the front of the queue.`}
        </p>
        <Button
          disabled={isPending || len === 0n}
          onClick={() =>
            writeContract({ ...predictionDuel, functionName: "claimDispute" })
          }
        >
          Claim next dispute
        </Button>
      </CardContent>
    </Card>
  );
}

function ActiveDisputes() {
  const { data, isLoading, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "getActiveDisputes",
    args: [0n, 50n],
  });
  const ids = (data as readonly bigint[] | undefined) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active disputes</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No initialised disputes. They appear here once someone calls
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              escalateToJury
            </code>
            .
          </p>
        ) : (
          <div className="space-y-3">
            {ids.map((id) => (
              <DisputeRow key={id.toString()} id={id} onChange={refetch} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DisputeRow({ id, onChange }: { id: bigint; onChange: () => void }) {
  const { data, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "getDisputeData",
    args: [id],
  });
  // tuple ordering matches Solidity returns:
  // round, lastRoundOutcome, selectedJurors, votingDeadline,
  // appealDeadline, round1Loser, round2Loser, feePool, initialized, finalized
  const dd = data as
    | readonly [
        number,
        number,
        readonly `0x${string}`[],
        bigint,
        bigint,
        `0x${string}`,
        `0x${string}`,
        bigint,
        boolean,
        boolean,
      ]
    | undefined;

  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Submitting…",
    successMsg: "Confirmed",
    onSuccess: () => {
      refetch();
      onChange();
    },
  });

  if (!dd) return <Skeleton className="h-16" />;

  const [round, , panel, votingDeadline, appealDeadline, , , , , finalized] = dd;
  const now = Math.floor(Date.now() / 1000);
  const inAppeal = appealDeadline !== 0n;
  const votingOpen = votingDeadline !== 0n && now < Number(votingDeadline);
  const votingExpired = votingDeadline !== 0n && now >= Number(votingDeadline);
  const appealExpired = inAppeal && now > Number(appealDeadline);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 p-3 text-sm">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Link
            href={`/duels/${id}`}
            className="font-medium text-foreground hover:text-primary"
          >
            Duel #{id.toString()}
          </Link>
          <Badge variant="primary">Round {round}</Badge>
          {finalized && <Badge variant="success">Finalized</Badge>}
          {inAppeal && !finalized && (
            <Badge variant="warn">Appeal window</Badge>
          )}
          {votingOpen && <Badge variant="warn">Voting open</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          Panel {panel.length} juror{panel.length === 1 ? "" : "s"} ·{" "}
          {votingDeadline !== 0n
            ? `voting ${votingOpen ? "ends" : "ended"} ${fmtDeadline(votingDeadline)} (${timeUntil(votingDeadline)})`
            : "panel still being assembled"}
          {inAppeal &&
            ` · appeal ${appealExpired ? "expired" : "ends"} ${fmtDeadline(appealDeadline)}`}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {votingOpen && (
          <>
            <Button
              size="sm"
              variant="success"
              disabled={isPending}
              onClick={() =>
                writeContract({
                  ...predictionDuel,
                  functionName: "juryVote",
                  args: [id, 1],
                })
              }
            >
              Vote YES
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() =>
                writeContract({
                  ...predictionDuel,
                  functionName: "juryVote",
                  args: [id, 2],
                })
              }
            >
              Vote NO
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                writeContract({
                  ...predictionDuel,
                  functionName: "juryVote",
                  args: [id, 3],
                })
              }
            >
              INVALID
            </Button>
          </>
        )}
        {(votingExpired || appealExpired) && !finalized && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              writeContract({
                ...predictionDuel,
                functionName: "finalizeJuryRound",
                args: [id],
              })
            }
          >
            Finalize round
          </Button>
        )}
      </div>
    </div>
  );
}
