// Deterministic demo data for `vite --mode mock`. Example domains only.
import type { Cert, Me, Overview, Site, StatsReport, TimeRange, TrafficPoint } from "@hcdn/api/types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

export const me: Me = {
  id: 1001,
  username: "demo",
  email: "demo@example.com",
  fullname: "演示账号",
  emailVerified: true,
  otpEnabled: false,
  createdAt: NOW - 45 * DAY,
  plan: { id: "pro", name: "专业版", trafficQuotaBytes: 5 * 1024 ** 4, domainsQuota: 20, expiresAt: NOW + 200 * DAY },
};

const RANGE: Record<TimeRange, { seconds: number; step: number }> = {
  "1h": { seconds: 3600, step: 300 },
  "24h": { seconds: DAY, step: 3600 },
  "7d": { seconds: 7 * DAY, step: 3 * 3600 },
  "30d": { seconds: 30 * DAY, step: DAY },
};

function diurnal(t: number) {
  // Asia-Pacific evening peak (UTC+8 ~ 21:00).
  const h = ((t / 3600 + 8) % 24 + 24) % 24;
  return 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(((h - 7) / 24) * Math.PI * 2 - Math.PI / 2 + Math.PI)), 1.4) * 0.5 + 0.3 * Math.exp(-Math.pow(h - 21, 2) / 8);
}

export function series(range: TimeRange, scale = 1, seed = 7): TrafficPoint[] {
  const { seconds, step } = RANGE[range];
  const r = rng(seed);
  const start = Math.floor((NOW - seconds) / step) * step;
  const out: TrafficPoint[] = [];
  for (let t = start + step; t <= NOW; t += step) {
    const base = diurnal(t) * (0.85 + r() * 0.3) * scale;
    const requests = Math.round(base * 52000 * (step / 3600));
    const bytes = Math.round(requests * (88_000 + r() * 30_000));
    const hit = 0.78 + r() * 0.15;
    out.push({
      t,
      bytes,
      cachedBytes: Math.round(bytes * hit),
      requests,
      cachedRequests: Math.round(requests * (hit - 0.04)),
      attackRequests: Math.round(requests * (0.004 + r() * 0.01)),
      bandwidthBps: Math.round((bytes * 8) / step),
    });
  }
  return out;
}

function totals(points: TrafficPoint[]) {
  return points.reduce(
    (a, p) => ({
      bytes: a.bytes + p.bytes,
      cachedBytes: a.cachedBytes + p.cachedBytes,
      requests: a.requests + p.requests,
      cachedRequests: a.cachedRequests + p.cachedRequests,
      attackRequests: a.attackRequests + p.attackRequests,
      peakBandwidthBps: Math.max(a.peakBandwidthBps, p.bandwidthBps * 1.35),
    }),
    { bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0, attackRequests: 0, peakBandwidthBps: 0 },
  );
}

export const sites: Site[] = [
  mkSite(1, ["www.example.com", "example.com"], "active", 4.2),
  mkSite(2, ["static.example.com"], "active", 9.6),
  mkSite(3, ["shop.example.net"], "active", 2.1),
  mkSite(4, ["api.example.org"], "pending_dns", 0),
  mkSite(5, ["blog.example.io"], "disabled", 0.2),
];

function mkSite(id: number, domains: string[], status: Site["status"], gb: number): Site {
  return {
    id,
    name: domains[0]!,
    domains,
    cname: `${(id * 2654435761 >>> 0).toString(36).slice(0, 8)}.cdn.example.com`,
    status,
    isOn: status !== "disabled",
    origins: [{ protocol: "https", host: `origin-${id}.example.net`, port: 443 }],
    originHost: "",
    https: { enabled: status === "active", certId: status === "active" ? id : null, autoCert: true, forceRedirect: true, hsts: false, http2: true, minTlsVersion: "1.2" },
    createdAt: NOW - (60 - id * 7) * DAY,
    traffic24h: gb > 0 ? { bytes: Math.round(gb * 1024 ** 3), requests: Math.round(gb * 11800) } : null,
    dnsCheckedAt: NOW - 600,
    dnsChecks: domains.map((d) => ({ domain: d, ok: status === "active", resolved: status === "active" ? ["xxxx.cdn.example.com"] : ["203.0.113.10"] })),
  };
}

export const certs: Cert[] = [
  { id: 1, name: "www.example.com", domains: ["www.example.com", "example.com"], issuer: "Let's Encrypt R11", notBefore: NOW - 20 * DAY, notAfter: NOW + 70 * DAY, isAcme: true, autoRenew: true, sitesCount: 1, status: "valid" },
  { id: 2, name: "static.example.com", domains: ["static.example.com"], issuer: "Let's Encrypt R10", notBefore: NOW - 80 * DAY, notAfter: NOW + 9 * DAY, isAcme: true, autoRenew: true, sitesCount: 1, status: "expiring" },
  { id: 3, name: "*.example.net", domains: ["*.example.net", "example.net"], issuer: "Example Trust CA", notBefore: NOW - 200 * DAY, notAfter: NOW + 160 * DAY, isAcme: false, autoRenew: false, sitesCount: 1, status: "valid" },
];

const REGIONS = [
  ["CN", "中国", 0.31],
  ["JP", "日本", 0.17],
  ["US", "美国", 0.14],
  ["HK", "中国香港", 0.09],
  ["SG", "新加坡", 0.07],
  ["KR", "韩国", 0.06],
  ["TW", "中国台湾", 0.05],
  ["DE", "德国", 0.03],
  ["AU", "澳大利亚", 0.03],
  ["GB", "英国", 0.02],
  ["TH", "泰国", 0.015],
  ["VN", "越南", 0.015],
] as const;

export function stats(range: TimeRange, scale = 1, seed = 7): StatsReport {
  const s = series(range, scale, seed);
  const prev = series(range, scale * 0.9, seed + 1);
  const t = totals(s);
  return {
    range,
    step: RANGE[range].step,
    totals: t,
    previous: totals(prev),
    series: s,
    statusCodes: [
      { code: "2xx", count: Math.round(t.requests * 0.902) },
      { code: "3xx", count: Math.round(t.requests * 0.061) },
      { code: "4xx", count: Math.round(t.requests * 0.032) },
      { code: "5xx", count: Math.round(t.requests * 0.005) },
    ],
    regions: REGIONS.map(([code, name, share]) => ({ code, name, bytes: Math.round(t.bytes * share), requests: Math.round(t.requests * share) })),
    topSites: sites
      .filter((x) => x.traffic24h)
      .map((x) => ({ siteId: x.id, domain: x.domains[0]!, bytes: Math.round((x.traffic24h!.bytes * t.bytes) / (16 * 1024 ** 3)), requests: x.traffic24h!.requests * 10 }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

export function overview(range: TimeRange): Overview {
  return {
    ...stats(range),
    sites: { total: sites.length, active: 3, pendingDns: 1, disabled: 1 },
    certs: { total: certs.length, expiringSoon: 1 },
  };
}
