"use client";

import Link from "next/link";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChainGuard } from "@/components/chain-guard";
import { useTxToast } from "@/components/tx-status";
import { predictionDuel } from "@/lib/contracts";
import { fmtDeadline, explainError, outcomeLabel } from "@/lib/format";
import { formatCountdown, useNow } from "@/lib/use-countdown";

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
  const { data: queueLen, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "getDisputeQueueLength",
  });
  const len = (queueLen as bigint | undefined) ?? 0n;
  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Claiming dispute…",
    successMsg: "Joined panel",
    onSuccess: () => refetch(),
  });

  const onClaim = () => {
    try {
      writeContract({ ...predictionDuel, functionName: "claimDispute" });
    } catch (e) {
      toast.error("Claim failed", { description: explainError(e) });
    }
  };

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
        <Button disabled={isPending || len === 0n} onClick={onClaim}>
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
            No initialised disputes. They appear here once someone calls{" "}
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
  const now = useNow();
  const { address } = useAccount();
  const { data, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "getDisputeData",
    args: [id],
  });
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

  type AnyWriteArgs = Parameters<typeof writeContract>[0];
  const send = (label: string, args: AnyWriteArgs | unknown) => {
    try {
      writeContract(args as AnyWriteArgs);
    } catch (e) {
      toast.error(`${label} failed`, { description: explainError(e) });
    }
  };

  if (!dd) return <Skeleton className="h-16" />;

  const [
    round,
    lastRoundOutcome,
    panel,
    votingDeadline,
    appealDeadline,
    ,
    ,
    feePool,
    ,
    finalized,
  ] = dd;
  const inAppeal = appealDeadline !== 0n;
  const votingOpen = votingDeadline !== 0n && now / 1000 < Number(votingDeadline);
  const votingExpired = votingDeadline !== 0n && now / 1000 >= Number(votingDeadline);
  const appealExpired = inAppeal && now / 1000 > Number(appealDeadline);
  const onPanel =
    address && panel.some((p) => p.toLowerCase() === address.toLowerCase());

  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/duels/${id}`}
              className="font-medium text-foreground hover:text-primary"
            >
              Duel #{id.toString()}
            </Link>
            <Badge variant="primary">Round {round} / 3</Badge>
            {finalized && <Badge variant="success">Finalized</Badge>}
            {inAppeal && !finalized && <Badge variant="warn">Appeal window</Badge>}
            {votingOpen && <Badge variant="warn">Voting open</Badge>}
            {onPanel && <Badge variant="muted">You&apos;re on this panel</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            Panel {panel.length} juror{panel.length === 1 ? "" : "s"} - fee pool{" "}
            <span className="font-mono">
              {(Number(feePool) / 1e18).toFixed(3)} ETH
            </span>
            {votingDeadline !== 0n && (
              <>
                {" - voting "}
                {votingOpen ? "ends" : "ended"}{" "}
                {fmtDeadline(votingDeadline)} ({formatCountdown(votingDeadline, now)})
              </>
            )}
            {inAppeal && (
              <>
                {" - appeal "}
                {appealExpired ? "expired" : "ends"}{" "}
                {fmtDeadline(appealDeadline)} ({formatCountdown(appealDeadline, now)})
              </>
            )}
            {finalized && lastRoundOutcome !== 0 && (
              <> - final verdict <strong>{outcomeLabel[lastRoundOutcome]}</strong></>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {votingOpen && onPanel && (
            <>
              <Button
                size="sm"
                variant="success"
                disabled={isPending}
                onClick={() =>
                  send("Vote YES", {
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
                  send("Vote NO", {
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
                  send("Vote INVALID", {
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
                send("Finalize", {
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
    </div>
  );
}
