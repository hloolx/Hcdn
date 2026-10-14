import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "../lib/cn";
import { Skeleton } from "../components/skeleton";

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  /** Relative change vs previous period, e.g. 0.12 = +12%. */
  delta?: number | null;
  /** When true, a decrease is good (e.g. error rate, latency). */
  invertDelta?: boolean;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  spark?: number[];
  sparkColor?: string;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  unit,
  delta,
  invertDelta,
  hint,
  icon,
  spark,
  sparkColor = "var(--chart-1)",
  loading,
  className,
}: StatCardProps) {
  const flat = delta != null && Math.abs(delta) < 0.0005;
  const up = delta != null && delta >= 0;
  const good = delta == null || flat ? null : invertDelta ? !up : up;
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border bg-card p-4 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[26px] leading-none font-semibold tracking-tight tabular">{value}</span>
            {unit ? <span className="text-sm font-medium text-muted-foreground">{unit}</span> : null}
          </div>
          <div className="mt-2 flex min-h-5 items-center gap-2 text-xs">
            {delta != null ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular",
                  good == null ? "bg-muted text-muted-foreground" : good ? "bg-success-soft text-success-foreground" : "bg-destructive-soft text-destructive-foreground",
                )}
              >
                {flat ? null : up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {Math.abs(delta * 100).toFixed(1)}%
              </span>
            ) : null}
            {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
          </div>
        </>
      )}
      {spark && spark.length > 1 && !loading ? (
        <Sparkline values={spark} color={sparkColor} className="pointer-events-none absolute right-3 bottom-3 h-9 w-24 opacity-90" />
      ) : null}
    </div>
  );
}

export function Sparkline({ values, color = "var(--chart-1)", className }: { values: number[]; color?: string; className?: string }) {
  const id = React.useId();
  const w = 96;
  const h = 36;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
