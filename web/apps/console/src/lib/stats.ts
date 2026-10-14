import type { TimeRange, TrafficTotals } from "@hcdn/api/types";

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

export function hitRatio(t: Pick<TrafficTotals, "requests" | "cachedRequests"> | null | undefined): number | null {
  if (!t || t.requests === 0) return null;
  return t.cachedRequests / t.requests;
}

export function byteHitRatio(t: Pick<TrafficTotals, "bytes" | "cachedBytes"> | null | undefined): number | null {
  if (!t || t.bytes === 0) return null;
  return t.cachedBytes / t.bytes;
}

/** Axis/tooltip time label that matches the bucket size. */
export function timeLabel(step: number, locale: string) {
  return (t: number) => {
    const d = new Date(t * 1000);
    if (step >= 86400) return d.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
    // Multi-day ranges with sub-day buckets: the date matters more than the hour.
    if (step >= 3 * 3600) return `${d.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" })} ${String(d.getHours()).padStart(2, "0")}:00`;
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

export const STATUS_COLORS: Record<string, string> = {
  "2xx": "var(--success)",
  "3xx": "var(--info)",
  "4xx": "var(--warning)",
  "5xx": "var(--destructive)",
};
