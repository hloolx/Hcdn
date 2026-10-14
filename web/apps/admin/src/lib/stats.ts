import type { TimeRange } from "@hcdn/api/types";

export const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
];

export function delta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Axis/tooltip time label that matches the bucket size. */
export function timeLabel(step: number, locale: string) {
  return (t: number) => {
    const d = new Date(t * 1000);
    if (step >= 86400) return d.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  };
}

export function tooltipTimeLabel(step: number, locale: string) {
  return (t: number) => {
    const d = new Date(t * 1000);
    if (step >= 86400) return d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
    return d.toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  };
}

/** Split "1.2 GB" into value + unit for StatCard. */
export function splitUnit(s: string): { value: string; unit?: string } {
  const i = s.lastIndexOf(" ");
  return i < 0 ? { value: s } : { value: s.slice(0, i), unit: s.slice(i + 1) };
}

/** 0..1 usage → meter tone: calm until it needs attention. */
export function usageTone(v: number | null | undefined): "primary" | "warning" | "danger" {
  if (v == null) return "primary";
  if (v >= 0.9) return "danger";
  if (v >= 0.75) return "warning";
  return "primary";
}

/** Compact bandwidth axis ticks ("1.5G", "500M"); tooltips keep the full unit. */
export function bitsAxis(v: number): string {
  const a = Math.abs(v);
  const trim = (n: number) => String(+n.toFixed(1));
  if (a >= 1e12) return `${trim(v / 1e12)}T`;
  if (a >= 1e9) return `${trim(v / 1e9)}G`;
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e3) return `${trim(v / 1e3)}K`;
  return String(Math.round(v));
}
