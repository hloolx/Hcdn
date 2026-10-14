// Number, size and time formatting shared by all apps.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const BIT_UNITS = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"] as const;

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${sign}${value.toFixed(unit === 0 ? 0 : digits)} ${BYTE_UNITS[unit]}`;
}

/** Bandwidth in bits per second. */
export function formatBits(bitsPerSecond: number | null | undefined, digits = 1): string {
  if (bitsPerSecond == null || !Number.isFinite(bitsPerSecond)) return "—";
  if (bitsPerSecond === 0) return "0 bps";
  let value = Math.abs(bitsPerSecond);
  let unit = 0;
  while (value >= 1000 && unit < BIT_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${BIT_UNITS[unit]}`;
}

/** Compact counts: 1.2万 / 3.4亿 in Chinese, 1.2K / 3.4M otherwise. */
export function formatCount(n: number | null | undefined, locale = "zh-CN"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (locale.startsWith("zh")) {
    const abs = Math.abs(n);
    if (abs >= 1e8) return `${trim(n / 1e8)}亿`;
    if (abs >= 1e4) return `${trim(n / 1e4)}万`;
    return n.toLocaleString("zh-CN");
  }
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatNumber(n: number | null | undefined, locale = "zh-CN"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(locale);
}

/** ratio 0..1 → "98.2%" */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatDateTime(value: number | string | Date | null | undefined, locale = "zh-CN"): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDate(value: number | string | Date | null | undefined, locale = "zh-CN"): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** "3 分钟前" / "3 minutes ago" */
export function formatRelative(value: number | string | Date | null | undefined, locale = "zh-CN"): string {
  const d = toDate(value);
  if (!d) return "—";
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

/** Days until a timestamp (negative when in the past). */
export function daysUntil(value: number | string | Date | null | undefined): number | null {
  const d = toDate(value);
  if (!d) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function toDate(value: number | string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Unix seconds are common in the API; treat small numbers as seconds.
  const d = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trim(n: number): string {
  return n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, "");
}
