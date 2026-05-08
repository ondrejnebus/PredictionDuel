import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { EthAmount } from "@/components/eth-amount";
import { fmtEth, outcomeLabel, shortAddr, timeUntil } from "@/lib/format";

export type DuelView = {
  id: bigint;
  creator: `0x${string}`;
  opponent: `0x${string}`;
  creatorStake: bigint;
  opponentStake: bigint;
  minOpponentReputation: bigint;
  voteDeadline: bigint;
  resolutionDeadline: bigint;
  status: number;
  creatorOutcome: number;
  opponentOutcome: number;
  creatorVote: number;
  opponentVote: number;
  question: string;
};

export function DuelCard({ duel }: { duel: DuelView }) {
  const total = duel.creatorStake + duel.opponentStake;
  return (
    <Link href={`/duels/${duel.id}`} className="block group">
      <Card className="transition-colors hover:border-primary/60">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 text-base font-medium leading-snug group-hover:text-primary">
              {duel.question}
            </h3>
            <StatusBadge status={duel.status} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Field label="Creator" value={shortAddr(duel.creator)} mono />
            <Field
              label="Bet"
              value={outcomeLabel[duel.creatorOutcome] ?? "-"}
            />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Pot
              </div>
              <EthAmount wei={total} className="text-foreground" bold />
              <div className="text-[11px] text-muted-foreground">
                {fmtEth(duel.creatorStake)} vs {fmtEth(duel.opponentStake)} ETH
              </div>
            </div>
            <Field
              label="Vote in"
              value={timeUntil(duel.voteDeadline)}
            />
          </div>

          {duel.minOpponentReputation > 0n && (
            <p className="text-xs text-muted-foreground">
              Requires opponent reputation ≥ {duel.minOpponentReputation.toString()}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function Field({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "font-mono text-foreground" : "text-foreground"}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
