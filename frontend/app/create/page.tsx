"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, parseEther } from "viem";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChainGuard } from "@/components/chain-guard";
import { predictionDuel } from "@/lib/contracts";
import { Outcome, explainError } from "@/lib/format";
import { useEthPrice } from "@/lib/use-eth-price";
import { cn } from "@/lib/utils";

const Outcomes = { YES: Outcome.YES, NO: Outcome.NO } as const;

function localDatetimeFromOffset(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function epochFromLocal(s: string): bigint {
  return BigInt(Math.floor(new Date(s).getTime() / 1000));
}

export default function CreateDuelPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create a duel</h1>
        <p className="text-sm text-muted-foreground">
          You set the question, both stakes, and the deadlines. The opponent
          can only accept the side opposite yours.
        </p>
      </header>
      <ChainGuard>
        <CreateForm />
      </ChainGuard>
    </div>
  );
}

type Unit = "ETH" | "USD";

function CreateForm() {
  const router = useRouter();
  useAccount();
  const { data: ethUsd } = useEthPrice();

  const [question, setQuestion] = useState(
    "Will ETH close above $4,000 on Dec 31, 2026?",
  );
  const [outcome, setOutcome] = useState<keyof typeof Outcomes>("YES");

  // Stakes are stored canonically in ETH (as numbers) and rendered in the
  // chosen unit. Letting the user type in USD is a presentation toggle.
  const [unit, setUnit] = useState<Unit>("ETH");
  const [creatorEth, setCreatorEth] = useState(0.01);
  const [opponentEth, setOpponentEth] = useState(0.01);
  // Ratio = creator / opponent. >1 means creator stakes more.
  const [ratio, setRatio] = useState(1);

  const [minRep, setMinRep] = useState("0");
  const [voteDeadline, setVoteDeadline] = useState(
    localDatetimeFromOffset(60 * 60),
  );
  const [resolutionDeadline, setResolutionDeadline] = useState(
    localDatetimeFromOffset(2 * 60 * 60),
  );

  // Display values (strings shown in the inputs, in the current unit).
  const fmt = (eth: number, unit: Unit, decimals = unit === "USD" ? 2 : 4) =>
    !isFinite(eth) || eth <= 0
      ? ""
      : (unit === "USD" && ethUsd ? eth * ethUsd : eth).toFixed(decimals);
  const [creatorStr, setCreatorStr] = useState(() => fmt(0.01, "ETH"));
  const [opponentStr, setOpponentStr] = useState(() => fmt(0.01, "ETH"));
  const [ratioStr, setRatioStr] = useState("1");

  // Reformat input strings when the unit toggles.
  const prevUnit = useRef(unit);
  useEffect(() => {
    if (prevUnit.current !== unit) {
      setCreatorStr(fmt(creatorEth, unit));
      setOpponentStr(fmt(opponentEth, unit));
      prevUnit.current = unit;
    }
  }, [unit, creatorEth, opponentEth, ethUsd]);

  // Convert a value typed in the input into ETH (number).
  const parseToEth = (val: string): number => {
    const n = parseFloat(val);
    if (!isFinite(n) || n <= 0) return 0;
    return unit === "USD" && ethUsd ? n / ethUsd : n;
  };

  // Editing one field updates the other two by these rules 
  // Edit my stake - ratio recomputes (opponent stays).
  // Edit opp stake - ratio recomputes (mine stays).
  // Edit ratio - opp = my / ratio (mine stays).
  const onCreatorEdit = (val: string) => {
    setCreatorStr(val);
    const my = parseToEth(val);
    setCreatorEth(my);
    if (my > 0 && opponentEth > 0) {
      const r = my / opponentEth;
      setRatio(r);
      setRatioStr(r.toFixed(2));
    }
  };
  const onOpponentEdit = (val: string) => {
    setOpponentStr(val);
    const opp = parseToEth(val);
    setOpponentEth(opp);
    if (creatorEth > 0 && opp > 0) {
      const r = creatorEth / opp;
      setRatio(r);
      setRatioStr(r.toFixed(2));
    }
  };
  const onRatioEdit = (val: string) => {
    setRatioStr(val);
    const r = parseFloat(val);
    if (!isFinite(r) || r <= 0) return;
    setRatio(r);
    if (creatorEth > 0) {
      const oppEth = creatorEth / r;
      setOpponentEth(oppEth);
      setOpponentStr(fmt(oppEth, unit));
    }
  };

  // Quick presets for ratio.
  const presets = [
    { label: "1 : 1", value: 1 },
    { label: "2 : 1", value: 2 },
    { label: "4 : 1", value: 4 },
    { label: "1 : 2", value: 0.5 },
    { label: "1 : 4", value: 0.25 },
  ];
  const applyPreset = (r: number) => {
    setRatio(r);
    setRatioStr(r % 1 === 0 ? r.toFixed(0) : r.toFixed(2));
    if (creatorEth > 0) {
      const oppEth = creatorEth / r;
      setOpponentEth(oppEth);
      setOpponentStr(fmt(oppEth, unit));
    }
  };

  //  Submit 
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const {
    data: receipt,
    isLoading: isMining,
    isSuccess,
  } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!isSuccess || !receipt) return;
    let newId: bigint | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== predictionDuel.address.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: predictionDuel.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "DuelCreated") {
          newId = (decoded.args as { id: bigint }).id;
          break;
        }
      } catch {}
    }
    toast.success(newId !== undefined ? `Duel #${newId} created` : "Duel created");
    reset();
    router.push(newId !== undefined ? `/duels/${newId}` : "/duels");
  }, [isSuccess, receipt, router, reset]);

  const validation = useMemo(() => {
    if (!question.trim()) return "Question is required";
    if (creatorEth <= 0) return "Your stake must be > 0";
    if (opponentEth <= 0) return "Opponent stake must be > 0";
    const vd = epochFromLocal(voteDeadline);
    const rd = epochFromLocal(resolutionDeadline);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (vd <= now) return "Vote deadline must be in the future";
    if (rd <= vd) return "Resolution deadline must be after vote deadline";
    return null;
  }, [question, creatorEth, opponentEth, voteDeadline, resolutionDeadline]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validation) {
      toast.error(validation);
      return;
    }
    try {
      writeContract({
        ...predictionDuel,
        functionName: "createDuel",
        args: [
          question.trim(),
          Outcomes[outcome],
          parseEther(toEthString(opponentEth)),
          BigInt(minRep || "0"),
          epochFromLocal(voteDeadline),
          epochFromLocal(resolutionDeadline),
        ],
        value: parseEther(toEthString(creatorEth)),
      });
    } catch (e) {
      toast.error("Could not submit", { description: explainError(e) });
    }
  };

  const busy = isPending || isMining;
  const usdLine = (eth: number) =>
    ethUsd && eth > 0
      ? `≈ $${(eth * ethUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "";
  const ethLine = (eth: number) =>
    eth > 0 && unit === "USD" ? `≈ ${eth.toFixed(4)} ETH` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>New duel</span>
          <UnitToggle unit={unit} setUnit={setUnit} ethUsd={ethUsd} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Question">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="A clear yes/no question with a verifiable answer"
              rows={2}
            />
          </Field>

          <Field label="Your prediction">
            <div className="flex gap-2">
              {(["YES", "NO"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setOutcome(opt)}
                  className={cn(
                    "flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                    outcome === opt
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              The opponent is automatically locked into the opposite side.
            </p>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Your stake (${unit})`}>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={creatorStr}
                onChange={(e) => onCreatorEdit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {unit === "ETH" ? usdLine(creatorEth) : ethLine(creatorEth)}
              </p>
            </Field>
            <Field label={`Opponent stake (${unit})`}>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={opponentStr}
                onChange={(e) => onOpponentEdit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {unit === "ETH" ? usdLine(opponentEth) : ethLine(opponentEth)}
              </p>
            </Field>
          </div>

          <Field label="Stake ratio (yours : opponent)">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={ratioStr}
                onChange={(e) => onRatioEdit(e.target.value)}
                className="w-32"
              />
              <span className="text-xs text-muted-foreground">
                = {ratio.toFixed(2)} : 1
                {ratio > 1
                  ? " - you favour your side (risk more)"
                  : ratio < 1
                    ? " - you're the underdog"
                    : " - even"}
              </span>
              <div className="ml-auto flex flex-wrap gap-1">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(p.value)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs transition-colors",
                      Math.abs(ratio - p.value) < 0.001
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Editing your stake recomputes the ratio. Editing the ratio
              recomputes the opponent's stake from yours.
            </p>
          </Field>

          <div className="rounded-md border border-border bg-secondary/30 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Total pot</span>
              <span className="font-semibold tabular-nums">
                {(creatorEth + opponentEth).toFixed(4)} ETH
                {ethUsd && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ≈ $
                    {((creatorEth + opponentEth) * ethUsd).toLocaleString(
                      undefined,
                      { maximumFractionDigits: 2 },
                    )}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vote deadline">
              <Input
                type="datetime-local"
                value={voteDeadline}
                onChange={(e) => setVoteDeadline(e.target.value)}
              />
            </Field>
            <Field label="Resolution deadline">
              <Input
                type="datetime-local"
                value={resolutionDeadline}
                onChange={(e) => setResolutionDeadline(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Both parties must vote before the vote deadline. After the
            resolution deadline, no-show paths kick in (refund or solo-voter
            wins, plus a no-show reputation penalty).
          </p>

          <Field label="Min opponent reputation (optional)">
            <Input
              type="number"
              min="0"
              step="1"
              value={minRep}
              onChange={(e) => setMinRep(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              0 = open to anyone. A positive number gates the duel to opponents
              with at least that reputation score.
            </p>
          </Field>

          {validation && (
            <p className="text-sm text-destructive">{validation}</p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {isPending
              ? "Confirm in wallet…"
              : isMining
                ? "Mining…"
                : "Create duel"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function UnitToggle({
  unit,
  setUnit,
  ethUsd,
}: {
  unit: Unit;
  setUnit: (u: Unit) => void;
  ethUsd: number | undefined;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-normal">
      {ethUsd && (
        <span className="text-muted-foreground">
          ETH = ${ethUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      )}
      <div className="flex rounded-md border border-border p-0.5">
        {(["ETH", "USD"] as const).map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setUnit(u)}
            disabled={u === "USD" && !ethUsd}
            className={cn(
              "rounded px-2 py-0.5 transition-colors",
              unit === u
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
              u === "USD" && !ethUsd && "cursor-not-allowed opacity-40",
            )}
          >
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

/// Convert an ETH-as-number to a string suitable for parseEther (≤18 decimals,
/// trimmed of trailing zeros). Avoids floating-point drift on submit.
function toEthString(eth: number): string {
  if (!isFinite(eth) || eth <= 0) return "0";
  // Up to 18 decimals; trim trailing zeros and any trailing dot.
  return eth
    .toFixed(18)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    || "0";
}
