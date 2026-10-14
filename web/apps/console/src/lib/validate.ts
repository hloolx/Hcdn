// Client-side validation helpers. The server validates again; these exist to
// give instant, specific feedback. Messages are Chinese source strings (t keys).

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** "HTTPS://WWW.Example.com:443/path" → "www.example.com" */
export function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  if (!s.startsWith("[")) s = s.replace(/:\d+$/, "");
  return s.replace(/\.$/, "");
}

export function isFqdn(s: string): boolean {
  if (s.length > 253) return false;
  const labels = s.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  return TLD.test(labels[labels.length - 1]!);
}

/** Returns an error message (t key) or null. Wildcards are allowed as the leftmost label only. */
export function domainError(d: string): string | null {
  if (!d) return "请输入域名";
  if (d.includes("*")) {
    if (!d.startsWith("*.") || d.slice(2).includes("*")) return "通配符只能出现在最左侧，例如 *.example.com";
    return isFqdn(d.slice(2)) && d.split(".").length >= 3 ? null : "通配符域名格式不正确";
  }
  if (isIPv4(d) || d.includes(":")) return "请填写域名，不支持 IP 地址";
  return isFqdn(d) ? null : "域名格式不正确";
}

export function isIPv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p === "0" || !p.startsWith("0")));
}

export function isIPv6(s: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(s) || !s.includes(":")) return false;
  const dbl = s.split("::");
  if (dbl.length > 2) return false;
  const groups = (part: string) => (part ? part.split(":") : []);
  const head = groups(dbl[0] ?? "");
  const tail = dbl.length === 2 ? groups(dbl[1] ?? "") : [];
  const all = [...head, ...tail];
  let count = all.length;
  const last = all[all.length - 1];
  if (last && last.includes(".")) {
    if (!isIPv4(last)) return false;
    count += 1; // embedded IPv4 takes two groups
    all.pop();
  }
  if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  return dbl.length === 2 ? count < 8 : count === 8;
}

/** IP address or CIDR block, IPv4 or IPv6. */
export function ipOrCidrError(s: string): string | null {
  const [addr = "", mask, extra] = s.split("/");
  if (extra != null) return "格式不正确";
  const v4 = isIPv4(addr);
  const v6 = !v4 && isIPv6(addr);
  if (!v4 && !v6) return "不是有效的 IP 地址";
  if (mask != null) {
    if (!/^\d{1,3}$/.test(mask)) return "掩码格式不正确";
    const n = Number(mask);
    if (n > (v4 ? 32 : 128)) return "掩码超出范围";
  }
  return null;
}

/** Origin host: domain name or IP address. */
export function originHostError(s: string): string | null {
  if (!s.trim()) return "请输入源站地址";
  const h = s.trim().replace(/^\[|\]$/g, "");
  if (isIPv4(h) || isIPv6(h)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) return "无需填写 http:// 或 https://";
  if (h.includes("/") || h.includes(":")) return "只填写主机名，端口请在右侧单独填写";
  return isFqdn(h.toLowerCase()) ? null : "请输入有效的域名或 IP 地址";
}

export function portError(p: number | string): string | null {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "端口范围 1–65535";
}

/** Split a textarea into trimmed, non-empty, unique lines. */
export function lines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

export function urlError(s: string, prefix = false): string | null {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "不是有效的 URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "只支持 http:// 或 https://";
  if (prefix && !u.pathname.endsWith("/")) return "目录需以 / 结尾";
  return null;
}
