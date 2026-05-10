"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChainGuard } from "@/components/chain-guard";
import { useTxToast } from "@/components/tx-status";
import { predictionDuel } from "@/lib/contracts";
import { fmtDeadline, explainError, outcomeLabel, Outcome } from "@/lib/format";
import { formatCountdown, useNow } from "@/lib/use-countdown";
import {
  clearCommit,
  computeCommitHash,
  loadCommit,
  randomSalt,
  saveCommit,
  type CommitRecord,
} from "@/lib/commit-reveal";

export default function JuryPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Jury</h1>
        <p className="text-sm text-muted-foreground">
          Stake to become a juror, claim disputes from the FIFO queue, and
          submit a hidden commit. Reveal happens automatically when you visit
          this page during the reveal window - no second click needed. (The
          contract&apos;s reveal is permissionless: another juror, a relayer,
          or anyone with your salt can also reveal on your behalf.) Vote with
          the majority or lose 0.02 ETH; skip the reveal and lose the same.
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
              <Skeleton key={i} className="h-24" />
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

type DisputeTuple = readonly [
  number, // round
  number, // lastRoundOutcome
  readonly `0x${string}`[], // selectedJurors
  bigint, // commitDeadline
  bigint, // revealDeadline
  bigint, // appealDeadline
  `0x${string}`,
  `0x${string}`,
  bigint, // feePool
  boolean, // initialized
  boolean, // finalized
];

function DisputeRow({ id, onChange }: { id: bigint; onChange: () => void }) {
  const now = useNow();
  const { address } = useAccount();
  const { data, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "getDisputeData",
    args: [id],
  });
  const dd = data as DisputeTuple | undefined;

  const { data: jurorState, refetch: refetchState } = useReadContract({
    ...predictionDuel,
    functionName: "getJurorCommitState",
    args: address ? [id, address] : undefined,
    query: { enabled: !!address },
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Submitting…",
    successMsg: "Confirmed",
    onSuccess: () => {
      refetch();
      refetchState();
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

  if (!dd) return <Skeleton className="h-24" />;

  const [
    round,
    lastRoundOutcome,
    panel,
    commitDeadline,
    revealDeadline,
    appealDeadline,
    ,
    ,
    feePool,
    ,
    finalized,
  ] = dd;
  const inAppeal = appealDeadline !== 0n;
  const inCommit = commitDeadline !== 0n && now / 1000 < Number(commitDeadline);
  const inReveal =
    commitDeadline !== 0n &&
    now / 1000 >= Number(commitDeadline) &&
    now / 1000 < Number(revealDeadline);
  const revealOver = revealDeadline !== 0n && now / 1000 >= Number(revealDeadline);
  const appealExpired = inAppeal && now / 1000 > Number(appealDeadline);
  const onPanel =
    address && panel.some((p) => p.toLowerCase() === address.toLowerCase());

  const stateTuple = jurorState as
    | readonly [boolean, boolean, number]
    | undefined;
  const hasCommitted = stateTuple?.[0] ?? false;
  const hasRevealed = stateTuple?.[1] ?? false;
  const onChainVote = stateTuple?.[2] ?? 0;

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3 text-sm">
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
            {inCommit && <Badge variant="warn">Commit phase</Badge>}
            {inReveal && <Badge variant="warn">Reveal phase</Badge>}
            {onPanel && <Badge variant="muted">You&apos;re on this panel</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            Panel {panel.length} juror{panel.length === 1 ? "" : "s"} · fee pool{" "}
            <span className="font-mono">
              {(Number(feePool) / 1e18).toFixed(3)} ETH
            </span>
            {commitDeadline !== 0n && (
              <>
                {" · commit ends "}
                {fmtDeadline(commitDeadline)} (
                {formatCountdown(commitDeadline, now)})
              </>
            )}
            {revealDeadline !== 0n && (
              <>
                {" · reveal ends "}
                {fmtDeadline(revealDeadline)} (
                {formatCountdown(revealDeadline, now)})
              </>
            )}
            {inAppeal && (
              <>
                {" · appeal "}
                {appealExpired ? "expired" : "ends"}{" "}
                {fmtDeadline(appealDeadline)} ({formatCountdown(appealDeadline, now)})
              </>
            )}
            {finalized && lastRoundOutcome !== 0 && (
              <> · final verdict <strong>{outcomeLabel[lastRoundOutcome]}</strong></>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(revealOver || appealExpired) && !finalized && (
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

      {onPanel && address && !finalized && (inCommit || inReveal) && (
        <CommitRevealPanel
          duelId={id}
          me={address}
          inCommit={inCommit}
          inReveal={inReveal}
          hasCommitted={hasCommitted}
          hasRevealed={hasRevealed}
          onChainVote={onChainVote}
          isPending={isPending}
          send={send}
        />
      )}
    </div>
  );
}

function CommitRevealPanel({
  duelId,
  me,
  inCommit,
  inReveal,
  hasCommitted,
  hasRevealed,
  onChainVote,
  isPending,
  send,
}: {
  duelId: bigint;
  me: `0x${string}`;
  inCommit: boolean;
  inReveal: boolean;
  hasCommitted: boolean;
  hasRevealed: boolean;
  onChainVote: number;
  isPending: boolean;
  send: (label: string, args: unknown) => void;
}) {
  // Pending local commit, if any. The salt+vote must survive page reloads
  // until the reveal phase, so we keep them in localStorage.
  const [record, setRecord] = useState<CommitRecord | null>(null);

  useEffect(() => {
    setRecord(loadCommit(duelId, me));
  }, [duelId, me]);

  const onCommit = (vote: number) => {
    const salt = randomSalt();
    const hash = computeCommitHash(duelId, me, vote, salt);
    const rec: CommitRecord = {
      duelId: duelId.toString(),
      juror: me,
      vote,
      salt,
      hash,
      committedAt: Math.floor(Date.now() / 1000),
    };
    saveCommit(rec);
    setRecord(rec);
    send("Commit", {
      ...predictionDuel,
      functionName: "commitJuryVote",
      args: [duelId, hash],
    });
  };

  const onReveal = () => {
    if (!record) {
      toast.error("No saved commit", {
        description:
          "We can't reveal without the salt. If you committed from a different browser, you'll need to find the original device.",
      });
      return;
    }
    send("Reveal", {
      ...predictionDuel,
      functionName: "revealJuryVote",
      args: [duelId, record.juror, record.vote, record.salt],
    });
  };

  // Once revealed on-chain we no longer need the local copy.
  useEffect(() => {
    if (hasRevealed) {
      clearCommit(duelId, me);
    }
  }, [hasRevealed, duelId, me]);

  // Auto-reveal: when the reveal phase is open, the juror has a stored
  // commit, hasn't revealed yet, and isn't already submitting another tx,
  // fire the reveal automatically. The user still signs the wallet popup,
  // but they don't have to remember to click "Reveal" - opening the page is
  // enough. `revealJuryVote` is permissionless, so a relayer or another
  // juror could also have done this on their behalf.
  const autoTriggered = useRef(false);
  useEffect(() => {
    if (autoTriggered.current) return;
    if (!inReveal) return;
    if (hasRevealed) return;
    if (!record) return;
    if (isPending) return;
    autoTriggered.current = true;
    toast.info("Auto-revealing your vote", {
      description: `Submitting your saved ${outcomeLabel[record.vote]} vote.`,
    });
    send("Auto-reveal", {
      ...predictionDuel,
      functionName: "revealJuryVote",
      args: [duelId, record.juror, record.vote, record.salt],
    });
  }, [inReveal, hasRevealed, record, isPending, duelId, send]);

  return (
    <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      {inCommit && !hasCommitted && (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-amber-400">
            Commit phase - pick a vote
          </div>
          <p className="text-xs text-muted-foreground">
            Your choice is hashed locally with a random salt; only the hash
            goes on-chain. The salt + outcome are saved in this browser so we
            can reveal automatically when the reveal phase opens - you&apos;ll
            see one wallet popup now and one when reveal time comes if you
            return to the page. If you commit from a private window or clear
            site data, you&apos;ll need to reveal manually from the original
            device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="success"
              disabled={isPending}
              onClick={() => onCommit(Outcome.YES)}
            >
              Commit YES
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={() => onCommit(Outcome.NO)}
            >
              Commit NO
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => onCommit(Outcome.INVALID)}
            >
              Commit INVALID
            </Button>
          </div>
        </>
      )}

      {inCommit && hasCommitted && (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-amber-400">
            Commit submitted
          </div>
          <p className="text-xs text-muted-foreground">
            Your hidden vote is recorded. Come back during the reveal phase to
            disclose it.
            {record && (
              <>
                {" "}Saved locally:{" "}
                <strong>{outcomeLabel[record.vote]}</strong>.
              </>
            )}
          </p>
        </>
      )}

      {inReveal && !hasRevealed && (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-amber-400">
            Reveal phase
          </div>
          {record ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">
                Reveal your saved vote (
                <strong>{outcomeLabel[record.vote]}</strong>) so it counts toward
                the verdict.
              </p>
              <Button size="sm" disabled={isPending} onClick={onReveal}>
                Reveal {outcomeLabel[record.vote]}
              </Button>
            </div>
          ) : hasCommitted ? (
            <p className="text-xs text-destructive">
              You committed but we can&apos;t find the salt in this browser.
              Switch to the device you committed from, otherwise the contract
              will slash you on finalization.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Commit phase ended. Without a prior commit you can&apos;t vote in
              this round.
            </p>
          )}
        </>
      )}

      {inReveal && hasRevealed && (
        <p className="text-xs text-emerald-400">
          Revealed <strong>{outcomeLabel[onChainVote]}</strong>. Wait for the
          reveal phase to end, then anyone can finalize.
        </p>
      )}
    </div>
  );
}
