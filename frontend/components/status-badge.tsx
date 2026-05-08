import { Badge } from "@/components/ui/badge";
import { Status, statusLabel } from "@/lib/format";

const variantFor = (s: number) => {
  switch (s) {
    case Status.CREATED:
      return "primary" as const;
    case Status.ACTIVE:
    case Status.VOTING:
      return "warn" as const;
    case Status.DISPUTED:
      return "danger" as const;
    case Status.SETTLED:
      return "success" as const;
    default:
      return "muted" as const;
  }
};

export function StatusBadge({ status }: { status: number }) {
  return <Badge variant={variantFor(status)}>{statusLabel[status]}</Badge>;
}
