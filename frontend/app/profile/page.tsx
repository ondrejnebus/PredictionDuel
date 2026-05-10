"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChainGuard } from "@/components/chain-guard";
import { ReputationBadge } from "@/components/reputation-badge";
import { useTxToast } from "@/components/tx-status";
import { predictionDuel, duelReputation } from "@/lib/contracts";
import { fmtEth, shortAddr, explainError } from "@/lib/format";

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your reputation, balances, and duel history.
        </p>
      </header>
      <ChainGuard>
        <ProfileBody />
      </ChainGuard>
    </div>
  );
}

function ProfileBody() {
  const { address } = useAccount();
  if (!address) return null;

  return (
    <div className="space-y-6">
      <ReputationCard user={address} />
      <NftPreviewCard user={address} />
      <WithdrawCard user={address} />
      <JurorCard user={address} />
      <MyDuelsCard user={address} />
    </div>
  );
}

function ReputationCard({ user }: { user: `0x${string}` }) {
  const { data, isLoading } = useReadContract({
    ...duelReputation,
    functionName: "getReputation",
    args: [user],
  });
  const { data: score } = useReadContract({
    ...duelReputation,
    functionName: "reputationScore",
    args: [user],
  });
  const rep = data as
    | {
        wins: bigint;
        losses: bigint;
        disputesInitiated: bigint;
        disputesWon: bigint;
        disputesLost: bigint;
        noShowCount: bigint;
        totalVolumeWei: bigint;
      }
    | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Reputation
          <ReputationBadge
            score={typeof score === "bigint" ? score : null}
            size="lg"
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !rep ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Wins" v={rep.wins.toString()} />
            <Stat label="Losses" v={rep.losses.toString()} />
            <Stat
              label="Disputes (W/L)"
              v={`${rep.disputesWon}/${rep.disputesLost}`}
            />
            <Stat label="No-shows" v={rep.noShowCount.toString()} />
            <Stat
              label="Total volume"
              v={`${fmtEth(rep.totalVolumeWei)} ETH`}
            />
            <Stat label="Address" v={shortAddr(user)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/// Decode the on-chain tokenURI (a base64 data URL containing JSON metadata)
/// and render a small NFT preview. Soulbound NFTs are lazy-minted, so this
/// gracefully shows "not minted yet" until the first record* event hits.
function NftPreviewCard({ user }: { user: `0x${string}` }) {
  // tokenId = uint256(uint160(addr)) — derive client-side to query metadata.
  const tokenId = useMemo(() => BigInt(user), [user]);
  const { data, isLoading, error } = useReadContract({
    ...duelReputation,
    functionName: "tokenURI",
    args: [tokenId],
  });

  const meta = useMemo(() => {
    const uri = data as string | undefined;
    if (!uri || !uri.startsWith("data:application/json;base64,")) return null;
    try {
      const json = atob(uri.split(",", 2)[1] ?? "");
      return JSON.parse(json) as {
        name?: string;
        description?: string;
        attributes?: { trait_type: string; value: string | number }[];
      };
    } catch {
      return null;
    }
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reputation NFT (soulbound)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : error || !meta ? (
          <p className="text-sm text-muted-foreground">
            No NFT minted yet. Your soulbound reputation NFT is created the
            first time you settle a duel or get a no-show recorded.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="font-medium">{meta.name ?? "Reputation"}</div>
              {meta.description && (
                <div className="text-xs text-muted-foreground">
                  {meta.description}
                </div>
              )}
            </div>
            {meta.attributes && (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {meta.attributes.map((a) => (
                  <div
                    key={a.trait_type}
                    className="rounded-md border border-border bg-secondary/30 p-2"
                  >
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {a.trait_type}
                    </div>
                    <div className="font-mono">{String(a.value)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              Token id: {tokenId.toString()} - transfers revert (soulbound).
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WithdrawCard({ user }: { user: `0x${string}` }) {
  const { data: pending, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "pendingWithdrawals",
    args: [user],
  });
  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Withdrawing…",
    successMsg: "Withdrawn",
    onSuccess: () => refetch(),
  });

  const balance = (pending as bigint | undefined) ?? 0n;
  const send = () => {
    try {
      writeContract({ ...predictionDuel, functionName: "withdraw" });
    } catch (e) {
      toast.error("Withdraw failed", { description: explainError(e) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending balance</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {fmtEth(balance)} <span className="text-base text-muted-foreground">ETH</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Settled winnings, refunds, and juror rewards. Pull-payment claim.
          </p>
        </div>
        <Button disabled={balance === 0n || isPending} onClick={send}>
          {isPending ? "Confirm in wallet…" : "Withdraw"}
        </Button>
      </CardContent>
    </Card>
  );
}

function JurorCard({ user }: { user: `0x${string}` }) {
  const { data, refetch } = useReadContract({
    ...predictionDuel,
    functionName: "getJurorInfo",
    args: [user],
  });
  const info = data as readonly [bigint, bigint, boolean] | undefined;
  const stake = info?.[0] ?? 0n;
  const lockedOn = info?.[1] ?? 0n;
  const active = info?.[2] ?? false;

  const { writeContract, data: hash, isPending } = useWriteContract();
  useTxToast({
    hash,
    pendingMsg: "Submitting…",
    successMsg: "Juror stake updated",
    onSuccess: () => refetch(),
  });

  const [unstakeAmount, setUnstakeAmount] = useState("");
  const locked = lockedOn !== 0n;

  // wagmi's writeContract has a discriminated-union arg type per functionName;
  // TS cannot narrow it through a generic helper, so we loosen here.
  type AnyWriteArgs = Parameters<typeof writeContract>[0];
  const send = (label: string, args: AnyWriteArgs | unknown) => {
    try {
      writeContract(args as AnyWriteArgs);
    } catch (e) {
      toast.error(`${label} failed`, { description: explainError(e) });
    }
  };

  const onTopUp = () =>
    send("Stake", {
      ...predictionDuel,
      functionName: "stakeAsJuror",
      value: parseEther("0.05"),
    });

  const onUnstake = () => {
    const trimmed = unstakeAmount.trim();
    if (!trimmed) {
      toast.error("Enter an amount");
      return;
    }
    let wei: bigint;
    try {
      wei = parseEther(trimmed);
    } catch {
      toast.error("Invalid amount");
      return;
    }
    if (wei === 0n) {
      toast.error("Amount must be > 0");
      return;
    }
    if (wei > stake) {
      toast.error("Amount exceeds your stake");
      return;
    }
    send("Unstake", {
      ...predictionDuel,
      functionName: "unstakeAsJuror",
      args: [wei],
    });
  };

  const onUnstakeAll = () => {
    if (stake === 0n) {
      toast.error("Nothing to unstake");
      return;
    }
    send("Unstake", {
      ...predictionDuel,
      functionName: "unstakeAsJuror",
      args: [stake],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Juror stake
          {active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="muted">Inactive</Badge>
          )}
          {locked && <Badge variant="warn">Locked</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {fmtEth(stake)} ETH
            </div>
            <p className="text-xs text-muted-foreground">
              {active ? "Eligible to claim disputes" : "Need ≥ 0.05 ETH staked"}
              {locked && (
                <>
                  {" - "}
                  locked on{" "}
                  <Link
                    href={`/duels/${lockedOn}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    duel #{lockedOn.toString()}
                  </Link>
                </>
              )}
            </p>
          </div>
          <Link
            href="/jury"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Open jury page ->
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={isPending} onClick={onTopUp}>
            Top up 0.05 ETH
          </Button>
        </div>

        <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Unstake
          </div>
          {locked ? (
            <p className="text-xs text-muted-foreground">
              You can&apos;t unstake while locked on a dispute. The lock is
              released when{" "}
              <Link
                href={`/duels/${lockedOn}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                duel #{lockedOn.toString()}
              </Link>{" "}
              finalises.
            </p>
          ) : stake === 0n ? (
            <p className="text-xs text-muted-foreground">
              Nothing staked yet.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="ETH"
                value={unstakeAmount}
                onChange={(e) => setUnstakeAmount(e.target.value)}
                className="w-32"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={onUnstake}
              >
                Unstake
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={onUnstakeAll}
              >
                All ({fmtEth(stake)} ETH)
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Unstaking below 0.05 ETH deactivates you as juror. Funds are
                credited to your pending balance — claim via Withdraw above.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MyDuelsCard({ user }: { user: `0x${string}` }) {
  const { data, isLoading } = useReadContract({
    ...predictionDuel,
    functionName: "getUserDuels",
    args: [user],
  });
  const ids = (data as readonly bigint[] | undefined) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>My duels</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10" />
        ) : ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t created or accepted any duels yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <Link
                key={id.toString()}
                href={`/duels/${id}`}
                className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm hover:bg-secondary"
              >
                #{id.toString()}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono">{v}</div>
    </div>
  );
}
