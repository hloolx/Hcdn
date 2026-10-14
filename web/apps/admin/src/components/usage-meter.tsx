import { cn } from "@hcdn/ui/lib/cn";
import { usageTone } from "@/lib/stats";

const TONE = { primary: "var(--chart-1)", warning: "var(--warning)", danger: "var(--destructive)" } as const;

/** Compact table-cell meter: a short track with the percentage beside it. */
export function UsageMeter({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const tone = usageTone(value);
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("flex items-center gap-2", className)} title={`${pct.toFixed(1)}%`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: TONE[tone] }} />
      </div>
      <span className={cn("w-9 text-right text-xs tabular", tone === "danger" ? "font-medium text-destructive-foreground" : tone === "warning" ? "text-warning-foreground" : "text-muted-foreground")}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}
