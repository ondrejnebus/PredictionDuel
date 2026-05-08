import { Badge } from "@/components/ui/badge";

export function ReputationBadge({
  score,
  size = "sm",
}: {
  score: bigint | number | null | undefined;
  size?: "sm" | "lg";
}) {
  if (score === null || score === undefined) {
    return (
      <Badge variant="muted" className={size === "lg" ? "px-3 py-1 text-sm" : ""}>
        rep -
      </Badge>
    );
  }
  const n = typeof score === "bigint" ? Number(score) : score;
  const variant: "danger" | "muted" | "success" =
    n < 0 ? "danger" : n > 10 ? "success" : "muted";
  return (
    <Badge variant={variant} className={size === "lg" ? "px-3 py-1 text-sm" : ""}>
      rep {n}
    </Badge>
  );
}
