import * as React from "react";
import { cn } from "../lib/cn";

/** Categorical series colors in fixed order (validated palette; never cycled). */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export interface SeriesDef {
  key: string;
  label: string;
  /** Defaults to the slot of the series' position in the definition list. */
  color?: string;
}

export function seriesColor(series: SeriesDef[], index: number): string {
  return series[index]?.color ?? SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

/** Legend with short line keys; shown above the plot for >= 2 series. */
export function ChartLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  if (series.length < 2) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {series.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-[3px] w-3.5 rounded-full" style={{ background: seriesColor(series, i) }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export interface TooltipRow {
  key: string;
  label: string;
  color: string;
  value: string;
}

/** Tooltip body: heading, then one row per series — value first (strong), label after, keyed by a short stroke. */
export function ChartTooltipBox({ heading, rows }: { heading?: React.ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="pointer-events-none min-w-40 rounded-lg border bg-popover/95 px-3 py-2.5 text-xs text-popover-foreground shadow-lg backdrop-blur-sm">
      {heading ? <div className="mb-1.5 font-medium text-muted-foreground">{heading}</div> : null}
      <div className="grid gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="font-semibold text-foreground tabular">{r.value}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card frame for a chart: title, optional headline figure, actions (e.g. a table toggle). */
export function ChartCard({
  title,
  description,
  figure,
  actions,
  legend,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  figure?: React.ReactNode;
  actions?: React.ReactNode;
  legend?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-xl border bg-card shadow-xs", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          {figure ? <div className="pt-1">{figure}</div> : null}
        </div>
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
      </div>
      {legend ? <div className="px-5 pt-3">{legend}</div> : null}
      <div className="min-w-0 flex-1 px-2 pt-2 pb-3">{children}</div>
    </div>
  );
}

/** Accessible data table alternative for any chart. */
export function ChartTable({
  columns,
  rows,
  className,
}: {
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, React.ReactNode>[];
  className?: string;
}) {
  return (
    <div className={cn("max-h-72 overflow-auto rounded-lg border scrollbar-thin", className)}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-subtle">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("px-3 py-2 font-medium text-muted-foreground", c.align === "right" ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-1.5 tabular", c.align === "right" ? "text-right" : "text-left")}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
