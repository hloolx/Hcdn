import * as React from "react";
import { cn } from "../lib/cn";

export interface BarListItem {
  key: string;
  label: React.ReactNode;
  value: number;
  /** Secondary figure shown after the value (e.g. share). */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Status-coded rows (HTTP classes) pass a status color; ranked lists stay one hue. */
  color?: string;
}

/**
 * Ranked horizontal bars rendered in HTML: label inside the track, value at the tip.
 * One hue for magnitude — color never encodes rank.
 */
export function BarList({
  items,
  formatValue = (v) => v.toLocaleString(),
  className,
  max,
  emptyText = "暂无数据",
}: {
  items: BarListItem[];
  formatValue?: (v: number) => string;
  className?: string;
  max?: number;
  emptyText?: string;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <div className={cn("py-8 text-center text-xs text-muted-foreground", className)}>{emptyText}</div>;
  }
  return (
    <ul className={cn("grid gap-1.5", className)}>
      {items.map((item) => {
        const pct = Math.max(0, Math.min(100, (item.value / top) * 100));
        return (
          <li key={item.key} className="group flex items-center gap-3" title={`${typeof item.label === "string" ? item.label : ""} ${formatValue(item.value)}`}>
            <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-md">
              <div
                className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-500"
                style={{ width: `${Math.max(pct, 1.5)}%`, background: item.color ?? "var(--chart-1)", opacity: 0.16 }}
              />
              <div
                className="absolute inset-y-[11px] left-0 w-[3px] rounded-full"
                style={{ background: item.color ?? "var(--chart-1)" }}
              />
              <div className="relative flex h-full items-center gap-2 pr-2 pl-3 text-[13px]">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </div>
            </div>
            <div className="w-24 shrink-0 text-right text-[13px] font-medium tabular">
              {formatValue(item.value)}
              {item.hint ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.hint}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Single-number meter (e.g. cache hit ratio): fill carries the value, track recedes. */
export function Meter({ value, label, className, tone = "primary" }: { value: number; label?: React.ReactNode; className?: string; tone?: "primary" | "success" | "warning" | "danger" }) {
  const color = { primary: "var(--chart-1)", success: "var(--success)", warning: "var(--warning)", danger: "var(--destructive)" }[tone];
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? <div className="flex justify-between text-xs text-muted-foreground">{label}</div> : null}
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
