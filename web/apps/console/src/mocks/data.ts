// Deterministic demo data for `vite --mode mock`. Example domains and
// documentation IP ranges only. Everything lives in memory; mutations through
// the mock handlers update these structures so UI flows work end to end.
import type {
  AccessKey,
  AccessLog,
  AccessLogQuery,
  AcmeTask,
  ActivityItem,
  CacheQuota,
  CacheSettings,
  CacheTask,
  Cert,
  CreateSiteRequest,
  DnsCheck,
  Me,
  Overview,
  Plan,
  SecuritySettings,
  Site,
  StatsReport,
  TimeRange,
  TrafficPoint,
} from "@hcdn/api/types";

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const GB = 1024 ** 3;

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

export const plans: Plan[] = [
  { id: "free", name: "免费版", priceMonthly: 0, currency: "CNY", trafficQuotaBytes: 100 * GB, domainsQuota: 3, features: ["全球边缘节点", "免费 HTTPS 证书", "基础缓存规则", "社区支持"], highlight: false },
  { id: "pro", name: "专业版", priceMonthly: 199, currency: "CNY", trafficQuotaBytes: 5 * 1024 ** 4, domainsQuota: 20, features: ["包含免费版全部功能", "WAF 与频率限制", "地区访问控制", "实时访问日志", "工单支持"], highlight: true },
  { id: "business", name: "商业版", priceMonthly: 999, currency: "CNY", trafficQuotaBytes: 30 * 1024 ** 4, domainsQuota: 100, features: ["包含专业版全部功能", "自定义 WAF 规则", "日志推送", "99.95% SLA", "专属技术经理"], highlight: false },
  { id: "enterprise", name: "企业版", priceMonthly: null, currency: "CNY", trafficQuotaBytes: null, domainsQuota: null, features: ["按需定制流量与节点", "私有化部署选项", "7×24 电话支持"], highlight: false },
];

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
      peakBandwidthBps: Math.max(a.peakBandwidthBps, Math.round(p.bandwidthBps * 1.35)),
    }),
    { bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0, attackRequests: 0, peakBandwidthBps: 0 },
  );
}

// ---------------------------------------------------------------- sites

function cnameFor(id: number) {
  return `${((id * 2654435761) >>> 0).toString(36).padStart(7, "x").slice(0, 8)}.cdn.example.com`;
}

function defaultHttps(on: boolean, certId: number | null): Site["https"] {
  return { enabled: on, certId, autoCert: certId == null, forceRedirect: on, hsts: false, http2: true, minTlsVersion: "1.2" };
}

function mkSite(id: number, domains: string[], status: Site["status"], gb: number, opts: Partial<Site> = {}): Site {
  const cname = cnameFor(id);
  const ok = status === "active" || status === "disabled";
  return {
    id,
    name: domains[0]!,
    domains,
    cname,
    status,
    isOn: status !== "disabled",
    origins: [{ protocol: "https", host: `origin-${id}.example.net`, port: 443 }],
    originHost: "",
    https: defaultHttps(status === "active", null),
    createdAt: NOW - (90 - id * 6) * DAY - id * 3671,
    traffic24h: gb > 0 ? { bytes: Math.round(gb * GB), requests: Math.round(gb * 11800) } : null,
    dnsCheckedAt: NOW - 600 - id * 97,
    dnsChecks: domains.map((d) => ({
      domain: d,
      ok,
      resolved: ok ? [cname] : ["203.0.113.10"],
      message: ok ? undefined : "解析到 A 记录 203.0.113.10，尚未指向 CNAME",
    })),
    ...opts,
  };
}

export const sites: Site[] = [
  mkSite(1, ["www.example.com", "example.com"], "active", 4.2, { https: defaultHttps(true, 1), origins: [{ protocol: "https", host: "origin-1.example.net", port: 443 }, { protocol: "https", host: "198.51.100.21", port: 443, weight: 50 }] }),
  mkSite(2, ["static.example.com"], "active", 9.6, { https: defaultHttps(true, 2) }),
  mkSite(3, ["shop.example.net", "m.shop.example.net", "pay.example.net"], "active", 2.1, { https: defaultHttps(true, 3), originHost: "shop.example.net" }),
  mkSite(4, ["api.example.com"], "pending_dns", 0, { origins: [{ protocol: "http", host: "198.51.100.40", port: 8080 }] }),
  mkSite(5, ["blog.example.net"], "disabled", 0.2, { https: defaultHttps(true, null) }),
  mkSite(6, ["img.example.com"], "active", 6.8, { https: defaultHttps(true, null) }),
  mkSite(7, ["docs.example.com"], "active", 0.9, { https: defaultHttps(true, 5) }),
  mkSite(8, ["*.cdn-test.example.net"], "error", 0, { origins: [{ protocol: "https", host: "origin-8.example.net", port: 8443 }] }),
  mkSite(9, ["download.example.com"], "active", 3.4, { origins: [{ protocol: "http", host: "203.0.113.55", port: 80 }] }),
  mkSite(10, ["video.example.net"], "active", 7.7, { https: defaultHttps(true, 3) }),
  mkSite(11, ["status.example.com"], "active", 0.05),
  mkSite(12, ["beta.example.net"], "pending_dns", 0),
];
sites[7]!.dnsChecks = [{ domain: "*.cdn-test.example.net", ok: false, resolved: [], message: "源站连接超时（origin-8.example.net:8443）" }];

let nextSiteId = 100;
/** How many DNS checks each pending site has had; the second check succeeds. */
const dnsCheckCount = new Map<number, number>();

export function allDomains(exceptSiteId?: number) {
  return new Set(sites.filter((s) => s.id !== exceptSiteId).flatMap((s) => s.domains));
}

export function createSite(req: CreateSiteRequest): Site {
  const id = nextSiteId++;
  const site = mkSite(id, req.domains, "pending_dns", 0, {
    origins: req.origins,
    originHost: req.originHost ?? "",
    https: { enabled: req.autoCert, certId: null, autoCert: req.autoCert, forceRedirect: req.forceHttps, hsts: false, http2: true, minTlsVersion: "1.2" },
    createdAt: Math.floor(Date.now() / 1000),
    dnsCheckedAt: null,
    dnsChecks: [],
  });
  sites.unshift(site);
  cacheSettings.set(id, presetCache(req.cachePreset));
  return site;
}

export function checkDns(site: Site): DnsCheck[] {
  const n = (dnsCheckCount.get(site.id) ?? 0) + 1;
  dnsCheckCount.set(site.id, n);
  const now = Math.floor(Date.now() / 1000);
  const results: DnsCheck[] = site.domains.map((d, i) => {
    if (site.status === "active" || site.status === "disabled") return { domain: d, ok: true, resolved: [site.cname] };
    if (site.status === "error") return { domain: d, ok: false, resolved: [], message: "源站连接超时，请检查源站地址与防火墙" };
    // Pending: the first check fails, later checks succeed (the "user fixed DNS" story).
    if (n >= 2) return { domain: d, ok: true, resolved: [site.cname] };
    return i % 2 === 0
      ? { domain: d, ok: false, resolved: ["203.0.113.10"], message: "解析到 A 记录 203.0.113.10，尚未指向 CNAME" }
      : { domain: d, ok: false, resolved: [], message: "未找到解析记录" };
  });
  site.dnsChecks = results;
  site.dnsCheckedAt = now;
  if (site.status === "pending_dns" && results.every((r) => r.ok)) site.status = site.isOn ? "active" : "disabled";
  return results;
}

// ---------------------------------------------------------------- per-site settings

function presetCache(preset: CreateSiteRequest["cachePreset"]): CacheSettings {
  if (preset === "none") return { enabled: false, rules: [] };
  if (preset === "dynamic")
    return {
      enabled: true,
      rules: [
        { id: "r1", match: { type: "extension", value: "js,css,png,jpg,jpeg,gif,svg,webp,woff2" }, ttlSeconds: 7 * DAY, ignoreQuery: false, enabled: true },
        { id: "r2", match: { type: "path_prefix", value: "/api/" }, ttlSeconds: 0, ignoreQuery: false, enabled: true },
      ],
    };
  return {
    enabled: true,
    rules: [
      { id: "r1", match: { type: "extension", value: "js,css,png,jpg,jpeg,gif,svg,webp,woff2,ico" }, ttlSeconds: 30 * DAY, ignoreQuery: true, enabled: true },
      { id: "r2", match: { type: "extension", value: "html,htm" }, ttlSeconds: 3600, ignoreQuery: false, enabled: true },
      { id: "r3", match: { type: "all", value: "" }, ttlSeconds: 600, ignoreQuery: false, enabled: true },
    ],
  };
}

export const cacheSettings = new Map<number, CacheSettings>();
export const securitySettings = new Map<number, SecuritySettings>();
for (const s of sites) cacheSettings.set(s.id, presetCache(s.id % 3 === 0 ? "dynamic" : "static"));

export function security(siteId: number): SecuritySettings {
  let v = securitySettings.get(siteId);
  if (!v) {
    v =
      siteId === 1
        ? {
            waf: { enabled: true, mode: "block" },
            ipAllow: ["198.51.100.0/24"],
            ipDeny: ["203.0.113.7", "203.0.113.128/25", "2001:db8:dead::/48"],
            blockedCountries: ["KP", "IR"],
            rateLimit: { enabled: true, requests: 300, periodSeconds: 60, blockSeconds: 600 },
          }
        : {
            waf: { enabled: false, mode: "log" },
            ipAllow: [],
            ipDeny: [],
            blockedCountries: [],
            rateLimit: { enabled: false, requests: 300, periodSeconds: 60, blockSeconds: 600 },
          };
    securitySettings.set(siteId, v);
  }
  return v;
}

// ---------------------------------------------------------------- certificates

export const certs: Cert[] = [
  { id: 1, name: "www.example.com", domains: ["www.example.com", "example.com"], issuer: "Let's Encrypt R11", notBefore: NOW - 20 * DAY, notAfter: NOW + 70 * DAY, isAcme: true, autoRenew: true, sitesCount: 0, status: "valid" },
  { id: 2, name: "static.example.com", domains: ["static.example.com"], issuer: "Let's Encrypt R10", notBefore: NOW - 80 * DAY, notAfter: NOW + 9 * DAY, isAcme: true, autoRenew: true, sitesCount: 0, status: "expiring" },
  { id: 3, name: "*.example.net", domains: ["*.example.net", "example.net"], issuer: "Example Trust CA", notBefore: NOW - 200 * DAY, notAfter: NOW + 160 * DAY, isAcme: false, autoRenew: false, sitesCount: 0, status: "valid" },
  { id: 4, name: "legacy.example.com", domains: ["legacy.example.com"], issuer: "Example Trust CA", notBefore: NOW - 400 * DAY, notAfter: NOW - 5 * DAY, isAcme: false, autoRenew: false, sitesCount: 0, status: "expired" },
  { id: 5, name: "docs.example.com", domains: ["docs.example.com"], issuer: "Let's Encrypt R11", notBefore: NOW - 85 * DAY, notAfter: NOW + 4 * DAY, isAcme: true, autoRenew: true, sitesCount: 0, status: "expiring" },
];
let nextCertId = 20;

export function certsWithUsage(): Cert[] {
  return certs.map((c) => ({ ...c, sitesCount: sites.filter((s) => s.https.certId === c.id).length }));
}

export function addCert(c: Omit<Cert, "id" | "sitesCount" | "status">): Cert {
  const days = (c.notAfter - Date.now() / 1000) / DAY;
  const cert: Cert = { ...c, id: nextCertId++, sitesCount: 0, status: days < 0 ? "expired" : days < 30 ? "expiring" : "valid" };
  certs.unshift(cert);
  return cert;
}

const acmeTasks: (AcmeTask & { startedMs: number })[] = [];
let nextAcmeId = 1;

export function createAcmeTask(domains: string[]): AcmeTask {
  const task = { id: nextAcmeId++, domains, status: "pending" as AcmeTask["status"], certId: null, error: null, createdAt: Math.floor(Date.now() / 1000), startedMs: Date.now() };
  acmeTasks.push(task);
  return strip(task);
}

function strip(t: AcmeTask & { startedMs: number }): AcmeTask {
  const { startedMs: _s, ...rest } = t;
  return rest;
}

export function acmeTask(id: number): AcmeTask | null {
  const t = acmeTasks.find((x) => x.id === id);
  if (!t) return null;
  if (t.status === "success" || t.status === "failed") return strip(t);
  const elapsed = Date.now() - t.startedMs;
  if (elapsed < 1500) t.status = "pending";
  else if (elapsed < 5000) t.status = "running";
  else {
    // Domains that don't point at us can't pass HTTP-01.
    const notOurs = t.domains.filter((d) => !sites.some((s) => s.domains.includes(d) && s.status !== "pending_dns"));
    if (notOurs.length > 0) {
      t.status = "failed";
      t.error = `域名 ${notOurs.join("、")} 尚未解析到 CDN，无法完成 HTTP-01 验证`;
    } else {
      const now = Math.floor(Date.now() / 1000);
      const cert = addCert({ name: t.domains[0]!, domains: t.domains, issuer: "Let's Encrypt R11", notBefore: now, notAfter: now + 90 * DAY, isAcme: true, autoRenew: true });
      t.status = "success";
      t.certId = cert.id;
    }
  }
  return strip(t);
}

// ---------------------------------------------------------------- cache tasks

export const cacheQuota: CacheQuota = { maxKeysPerTask: 100, maxKeysPerDay: 2000, usedToday: 38 };

type MockTask = CacheTask & { startedMs: number | null };
export const cacheTasks: MockTask[] = [
  { id: 9, type: "purge", keyType: "url", targets: ["https://www.example.com/index.html", "https://www.example.com/app.js"], status: "done", createdAt: NOW - 1800, doneAt: NOW - 1790, done: 2, total: 2, startedMs: null },
  { id: 8, type: "preheat", keyType: "url", targets: Array.from({ length: 24 }, (_, i) => `https://static.example.com/assets/chunk-${i + 1}.js`), status: "done", createdAt: NOW - 5 * 3600, doneAt: NOW - 5 * 3600 + 74, done: 24, total: 24, startedMs: null },
  { id: 7, type: "purge", keyType: "prefix", targets: ["https://img.example.com/banners/"], status: "done", createdAt: NOW - DAY - 3000, doneAt: NOW - DAY - 2950, done: 1, total: 1, startedMs: null },
  { id: 6, type: "preheat", keyType: "url", targets: ["https://download.example.com/app/v2.4.0/setup.exe", "https://download.example.com/app/v2.4.0/setup.dmg"], status: "failed", createdAt: NOW - 2 * DAY, doneAt: NOW - 2 * DAY + 300, done: 1, total: 2, startedMs: null },
  { id: 5, type: "purge", keyType: "url", targets: ["https://shop.example.net/"], status: "done", createdAt: NOW - 3 * DAY, doneAt: NOW - 3 * DAY + 8, done: 1, total: 1, startedMs: null },
];
let nextCacheTaskId = 10;

export function addCacheTask(type: CacheTask["type"], keyType: CacheTask["keyType"], targets: string[]): CacheTask {
  const task: MockTask = { id: nextCacheTaskId++, type, keyType, targets, status: "pending", createdAt: Math.floor(Date.now() / 1000), doneAt: null, done: 0, total: targets.length, startedMs: Date.now() };
  cacheTasks.unshift(task);
  cacheQuota.usedToday += targets.length;
  return publicTask(task);
}

export function publicTask(t: MockTask): CacheTask {
  if (t.startedMs != null && t.status !== "done" && t.status !== "failed") {
    // Purges finish in ~3 s, preheats take ~1.5 s per URL.
    const elapsed = (Date.now() - t.startedMs) / 1000;
    const per = t.type === "purge" ? 3 / Math.max(1, t.total) : 1.5;
    t.done = Math.min(t.total, Math.floor(elapsed / per));
    t.status = elapsed < 0.8 ? "pending" : t.done >= t.total ? "done" : "running";
    if (t.status === "done") t.doneAt = Math.floor(Date.now() / 1000);
  }
  const { startedMs: _s, ...rest } = t;
  return rest;
}

// ---------------------------------------------------------------- account

export const accessKeys: AccessKey[] = [
  { id: 2, accessKeyId: "AKIDhc7Q2mN4pX8sV1tB", description: "CI 刷新缓存", isOn: true, createdAt: NOW - 20 * DAY, lastUsedAt: NOW - 3 * 3600 },
  { id: 1, accessKeyId: "AKIDhc3K9wE6rT2yU5iO", description: "监控脚本（只读）", isOn: false, createdAt: NOW - 40 * DAY, lastUsedAt: NOW - 12 * DAY },
];
let nextKeyId = 3;

function randomToken(len: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

export function createAccessKey(description: string) {
  const key: AccessKey = { id: nextKeyId++, accessKeyId: `AKIDhc${randomToken(14)}`, description, isOn: true, createdAt: Math.floor(Date.now() / 1000), lastUsedAt: null };
  accessKeys.unshift(key);
  return { key, secret: randomToken(40) };
}

export const activity: ActivityItem[] = [
  { id: 12, time: NOW - 420, action: "登录控制台", ip: "203.0.113.24" },
  { id: 11, time: NOW - 1800, action: "刷新缓存：2 个 URL", ip: "203.0.113.24" },
  { id: 10, time: NOW - 3 * 3600, action: "修改网站 www.example.com 的安全设置", ip: "203.0.113.24" },
  { id: 9, time: NOW - 5 * 3600, action: "预热缓存：24 个 URL", ip: "198.51.100.73" },
  { id: 8, time: NOW - DAY - 600, action: "申请证书 docs.example.com", ip: "198.51.100.73" },
  { id: 7, time: NOW - 2 * DAY, action: "创建 API 密钥", ip: "203.0.113.24" },
  { id: 6, time: NOW - 3 * DAY, action: "添加网站 beta.example.net", ip: "203.0.113.24" },
  { id: 5, time: NOW - 6 * DAY, action: "修改登录密码", ip: "2001:db8:85a3::8a2e:370:7334" },
];
let nextActivityId = 13;
export function logActivity(action: string) {
  activity.unshift({ id: nextActivityId++, time: Math.floor(Date.now() / 1000), action, ip: "203.0.113.24" });
}

// ---------------------------------------------------------------- stats

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

function trafficGb(s: Site) {
  return s.isOn && s.traffic24h ? s.traffic24h.bytes / GB : 0;
}

export function stats(range: TimeRange, siteId?: number): StatsReport {
  const totalGb = sites.reduce((a, s) => a + trafficGb(s), 0);
  let pool = sites.filter((x) => trafficGb(x) > 0);
  let scale = totalGb > 0 ? 1 : 0;
  let seed = 7;
  if (siteId) {
    const site = sites.find((s) => s.id === siteId);
    const gb = site ? trafficGb(site) : 0;
    scale = totalGb > 0 ? gb / totalGb : 0;
    seed = 7 + siteId;
    pool = site && gb > 0 ? [site] : [];
  }
  if (scale === 0) return emptyStats(range);
  const s = series(range, scale, seed);
  const prev = series(range, scale * 0.9, seed + 1);
  const t = totals(s);
  const poolGb = pool.reduce((a, x) => a + trafficGb(x), 0) || 1;
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
    topSites: pool
      .map((x) => ({ siteId: x.id, domain: x.domains[0]!, bytes: Math.round((trafficGb(x) / poolGb) * t.bytes), requests: Math.round((trafficGb(x) / poolGb) * t.requests) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 10),
  };
}

export function emptyStats(range: TimeRange): StatsReport {
  const s = series(range, 0, 1).map((p) => ({ ...p, bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0, attackRequests: 0, bandwidthBps: 0 }));
  const zero = { bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0, attackRequests: 0, peakBandwidthBps: 0 };
  return { range, step: RANGE[range].step, totals: zero, previous: null, series: s, statusCodes: [], regions: [], topSites: [] };
}

export function overview(range: TimeRange): Overview {
  const days = (c: Cert) => (c.notAfter - Date.now() / 1000) / DAY;
  return {
    ...stats(range),
    sites: {
      total: sites.length,
      active: sites.filter((s) => s.status === "active").length,
      pendingDns: sites.filter((s) => s.status === "pending_dns").length,
      disabled: sites.filter((s) => s.status === "disabled").length,
    },
    certs: { total: certs.length, expiringSoon: certs.filter((c) => days(c) >= 0 && days(c) < 30).length },
  };
}

// ---------------------------------------------------------------- access logs

const PATHS = [
  "/", "/index.html", "/assets/app.3f9a1c.js", "/assets/vendor.81be2d.js", "/assets/app.c41d0e.css", "/images/hero@2x.webp",
  "/images/logo.svg", "/api/v1/products?page=2&sort=price", "/api/v1/cart", "/api/v1/session", "/fonts/inter-var.woff2",
  "/favicon.ico", "/robots.txt", "/sitemap.xml", "/blog/2026/edge-caching-explained-for-busy-engineers", "/download/app/v2.4.0/setup.exe",
  "/video/intro/1080p/segment-00042.ts", "/static/js/chunk-vendors.6c1f.js", "/wp-login.php", "/.env", "/search?q=cdn+%E5%8A%A0%E9%80%9F&from=home&utm_source=newsletter",
];
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36",
  "curl/8.9.1",
  "Mozilla/5.0 (compatible; ExampleBot/2.1; +https://bot.example.com/)",
];
const LOG_REGIONS = ["中国 上海", "中国 广东", "日本 东京", "中国香港", "新加坡", "韩国 首尔", "美国 加利福尼亚", "中国台湾", "德国 黑森", "澳大利亚 新南威尔士"];

let logPool: AccessLog[] | null = null;
function buildLogs(): AccessLog[] {
  const r = rng(4242);
  const hosts = sites.filter((s) => s.traffic24h).flatMap((s) => s.domains.filter((d) => !d.startsWith("*")));
  const out: AccessLog[] = [];
  let t = Date.now() / 1000;
  for (let i = 0; i < 1800; i++) {
    t -= 2 + r() * (i < 300 ? 8 : 420);
    const host = hosts[Math.floor(r() * hosts.length)]!;
    const path = PATHS[Math.floor(Math.pow(r(), 1.6) * PATHS.length)]!;
    const attack = path === "/wp-login.php" || path === "/.env";
    const roll = r();
    const status = attack ? 403 : roll < 0.84 ? 200 : roll < 0.9 ? 304 : roll < 0.93 ? 301 : roll < 0.975 ? 404 : roll < 0.99 ? 429 : r() < 0.5 ? 502 : 504;
    const isApi = path.startsWith("/api/");
    const cache: AccessLog["cache"] = attack || status >= 500 ? "-" : isApi ? "BYPASS" : r() < 0.86 ? "HIT" : "MISS";
    const big = path.includes("setup.exe") ? 48_000_000 : path.includes(".ts") ? 2_400_000 : path.includes(".webp") ? 180_000 : path.includes(".js") ? 96_000 : 8_200;
    const ip6 = r() < 0.12;
    out.push({
      id: `log-${i}`,
      time: Math.round(t * 1000) / 1000,
      clientIp: ip6 ? `2001:db8:${Math.floor(r() * 0xffff).toString(16)}::${Math.floor(r() * 0xfff).toString(16)}` : `${r() < 0.6 ? "203.0.113" : "198.51.100"}.${1 + Math.floor(r() * 253)}`,
      region: LOG_REGIONS[Math.floor(Math.pow(r(), 1.3) * LOG_REGIONS.length)]!,
      method: isApi && r() < 0.35 ? "POST" : r() < 0.02 ? "HEAD" : "GET",
      scheme: r() < 0.93 ? "https" : "http",
      host,
      path,
      status,
      bytes: status === 304 ? 0 : Math.round(big * (0.6 + r() * 0.8)),
      durationMs: cache === "HIT" ? Math.round(2 + r() * 18) : Math.round(40 + r() * (status >= 500 ? 30000 : 420)),
      cache,
      userAgent: attack ? "python-requests/2.32.3" : UAS[Math.floor(r() * UAS.length)]!,
      referer: r() < 0.5 ? `https://${host}/` : "",
      wafAction: attack ? "block" : status === 429 ? "rate_limit" : null,
    });
  }
  return out;
}

export function queryLogs(q: AccessLogQuery): { items: AccessLog[]; nextCursor: string | null } {
  logPool ??= buildLogs();
  const site = q.siteId ? sites.find((s) => s.id === q.siteId) : null;
  const kw = (q.keyword ?? "").toLowerCase();
  const filtered = logPool.filter(
    (l) =>
      (!site || site.domains.includes(l.host)) &&
      (!q.from || l.time >= q.from) &&
      (!q.to || l.time <= q.to) &&
      (!q.status || String(l.status)[0] === q.status[0]) &&
      (!q.ip || l.clientIp.startsWith(q.ip)) &&
      (!kw || l.path.toLowerCase().includes(kw) || l.host.includes(kw) || l.userAgent.toLowerCase().includes(kw)),
  );
  const offset = q.cursor ? Number(q.cursor) || 0 : 0;
  const size = Math.min(200, q.size ?? 50);
  const items = filtered.slice(offset, offset + size);
  return { items, nextCursor: offset + size < filtered.length ? String(offset + size) : null };
}
