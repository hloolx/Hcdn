// Deterministic demo data for `vite --mode mock`.
// Example domains (example.com / example.net) and documentation IP ranges only.
import type {
  AdminAlert,
  AdminCert,
  AdminDashboard,
  AdminMe,
  AdminSite,
  AdminUser,
  AuditLog,
  Cluster,
  DnsDomain,
  DnsProvider,
  NodeDetail,
  NodeSummary,
  SiteStatus,
  SystemSettings,
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
const HOUR = 3600;

export const me: AdminMe = { id: 1, username: "admin", fullname: "运维管理员", isSuper: true };

// ---------------------------------------------------------------- traffic

const RANGE: Record<TimeRange, { seconds: number; step: number }> = {
  "1h": { seconds: HOUR, step: 300 },
  "24h": { seconds: DAY, step: HOUR },
  "7d": { seconds: 7 * DAY, step: 3 * HOUR },
  "30d": { seconds: 30 * DAY, step: DAY },
};

/** 0..1-ish daily load curve with an Asia-Pacific evening peak (UTC+8 ~ 21:00). */
function diurnal(t: number) {
  const h = (((t / 3600 + 8) % 24) + 24) % 24;
  return 0.3 + 0.45 * Math.max(0, Math.sin(((h - 8) / 24) * Math.PI * 2)) + 0.35 * Math.exp(-Math.pow(h - 21, 2) / 6);
}

function series(range: TimeRange, scale: number, seed: number): TrafficPoint[] {
  const { seconds, step } = RANGE[range];
  const r = rng(seed);
  const start = Math.floor((NOW - seconds) / step) * step;
  const out: TrafficPoint[] = [];
  for (let t = start + step; t <= NOW; t += step) {
    const base = (step >= DAY ? 0.62 : diurnal(t)) * (0.9 + r() * 0.2) * scale;
    const requests = Math.round(base * 1_450_000 * (step / 3600));
    const bytes = Math.round(requests * (96_000 + r() * 24_000));
    const hit = 0.82 + r() * 0.1;
    out.push({
      t,
      bytes,
      cachedBytes: Math.round(bytes * hit),
      requests,
      cachedRequests: Math.round(requests * (hit - 0.03)),
      attackRequests: Math.round(requests * (0.003 + r() * 0.008)),
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
      peakBandwidthBps: Math.max(a.peakBandwidthBps, p.bandwidthBps * 1.3),
    }),
    { bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0, attackRequests: 0, peakBandwidthBps: 0 },
  );
}

// ---------------------------------------------------------------- clusters & nodes

interface ClusterRow {
  id: number;
  name: string;
  domainId: number | null;
  dnsName: string;
  ttl: number;
  isDefault: boolean;
}

export const clusterRows: ClusterRow[] = [
  { id: 1, name: "默认集群", domainId: 1, dnsName: "cdn", ttl: 300, isDefault: true },
  { id: 2, name: "日本优化线路", domainId: null, dnsName: "", ttl: 300, isDefault: false },
];

function mkNode(
  id: number,
  name: string,
  clusterId: number,
  ips: string[],
  region: string,
  up: boolean,
  load: { cpu: number; mem: number; conn: number; bw: number },
): NodeSummary {
  return {
    id,
    name,
    clusterId,
    clusterName: "",
    ips,
    isOn: true,
    isUp: up,
    isInstalled: true,
    region,
    version: id === 5 ? "1.4.0" : "1.4.2",
    cpu: up ? load.cpu : null,
    memory: up ? load.mem : null,
    load1: up ? Math.round(load.cpu * 8 * 100) / 100 : null,
    connections: up ? load.conn : null,
    bandwidthBps: up ? load.bw : null,
    updatedAt: up ? NOW - 8 - id * 3 : NOW - 3 * HOUR - 840,
  };
}

export const nodes: NodeSummary[] = [
  mkNode(1, "tyo-01", 1, ["203.0.113.11", "2001:db8:10::11"], "日本 · 东京", true, { cpu: 0.46, mem: 0.63, conn: 18_420, bw: 1.86e9 }),
  mkNode(2, "tyo-02", 1, ["203.0.113.12", "2001:db8:10::12"], "日本 · 东京", true, { cpu: 0.38, mem: 0.57, conn: 15_108, bw: 1.52e9 }),
  mkNode(3, "lax-01", 1, ["198.51.100.21", "2001:db8:20::21"], "美国 · 洛杉矶", true, { cpu: 0.27, mem: 0.48, conn: 9_872, bw: 0.94e9 }),
  mkNode(4, "tyo-03", 2, ["203.0.113.13"], "日本 · 东京", true, { cpu: 0.81, mem: 0.74, conn: 22_315, bw: 2.31e9 }),
  mkNode(5, "hkg-01", 1, ["198.51.100.31"], "中国 · 香港", false, { cpu: 0, mem: 0, conn: 0, bw: 0 }),
];

export function clusterName(id: number) {
  return clusterRows.find((c) => c.id === id)?.name ?? "—";
}

export function nodeView(n: NodeSummary): NodeSummary {
  return { ...n, clusterName: clusterName(n.clusterId) };
}

export function nodeDetail(n: NodeSummary): NodeDetail {
  const r = rng(n.id * 97);
  const step = 600;
  const start = Math.floor((NOW - DAY) / step) * step;
  const pts: NodeDetail["series"] = [];
  const up = n.isUp && n.isOn;
  const outageFrom = NOW - 3 * HOUR - 840;
  for (let t = start + step; t <= NOW; t += step) {
    const d = diurnal(t);
    const alive = up || t < outageFrom;
    const cpuBase = n.cpu ?? 0.4;
    const memBase = n.memory ?? 0.55;
    pts.push({
      t,
      cpu: alive ? Math.min(0.98, cpuBase * (0.55 + d * 0.7) * (0.92 + r() * 0.16)) : 0,
      memory: alive ? Math.min(0.97, memBase * (0.9 + d * 0.12) + r() * 0.02) : 0,
      bandwidthBps: alive ? Math.round((n.bandwidthBps ?? 1.1e9) * (0.4 + d * 0.75) * (0.9 + r() * 0.2)) : 0,
      connections: alive ? Math.round((n.connections ?? 12_000) * (0.45 + d * 0.7) * (0.9 + r() * 0.2)) : 0,
    });
  }
  const cluster = clusterRows.find((c) => c.id === n.clusterId);
  const domain = cluster?.domainId ? domains.find((d) => d.id === cluster.domainId) : undefined;
  const fqdn = domain && cluster?.dnsName ? `${cluster.dnsName}.${domain.name}` : null;
  const dnsRecords = fqdn && n.isOn && n.isUp ? n.ips.map((ip) => `${fqdn}  ${ip.includes(":") ? "AAAA" : "A"}  ${ip}`) : [];
  return { ...nodeView(n), series: pts, dnsRecords };
}

let nodeSeq = 100;
export function newNode(clusterId: number, name: string, ips: string[]) {
  const node: NodeSummary = {
    id: ++nodeSeq,
    name,
    clusterId,
    clusterName: "",
    ips,
    isOn: true,
    isUp: false,
    isInstalled: false,
    region: "",
    version: "",
    cpu: null,
    memory: null,
    load1: null,
    connections: null,
    bandwidthBps: null,
    updatedAt: null,
  };
  nodes.push(node);
  const r = rng(nodeSeq * 13);
  const hex = (len: number) => Array.from({ length: len }, () => Math.floor(r() * 16).toString(16)).join("");
  return {
    node: nodeView(node),
    install: { nodeId: hex(32), secret: hex(32), endpoints: ["https://api.example.com:8003"] },
  };
}

export function clusterView(c: ClusterRow): Cluster {
  const ns = nodes.filter((n) => n.clusterId === c.id);
  const domain = c.domainId ? domains.find((d) => d.id === c.domainId) : undefined;
  return {
    id: c.id,
    name: c.name,
    nodesCount: ns.length,
    onlineNodes: ns.filter((n) => n.isOn && n.isUp).length,
    sitesCount: sites.filter((s) => s.clusterId === c.id).length,
    dnsDomain: domain?.name ?? "",
    dnsName: domain ? c.dnsName : "",
    dnsProviderName: domain?.providerName ?? "",
    isDefault: c.isDefault,
  };
}

// ---------------------------------------------------------------- users

const USERNAMES = [
  "acme", "lumen", "nova-games", "orbit", "pixelfox", "harbor", "kumo", "sakura-media", "atlas", "bluewave",
  "cedar", "delta-shop", "ember", "fjord", "granite", "helix", "iris-labs", "juniper", "kite", "lotus-edu",
  "maple", "nimbus", "onyx", "prism", "quartz",
];
const FULLNAMES = [
  "示例科技有限公司", "流明网络", "新星游戏", "轨道传媒", "像素狐工作室", "港湾电商", "云间科技", "樱花影视", "阿特拉斯", "蓝浪科技",
  "雪松软件", "三角洲商城", "余烬互娱", "峡湾数据", "花岗岩云", "螺旋生物", "鸢尾实验室", "杜松咨询", "风筝出行", "莲花教育",
  "枫叶资讯", "雨云存储", "玛瑙金融", "棱镜设计", "石英智能",
];

export const users: AdminUser[] = USERNAMES.map((username, i) => {
  const r = rng(i * 31 + 5);
  return {
    id: 1001 + i,
    username,
    email: `${username.replace(/-/g, ".")}@${i % 3 === 0 ? "example.net" : "example.com"}`,
    fullname: FULLNAMES[i] ?? "",
    isOn: ![6, 13, 21].includes(i),
    sitesCount: 0,
    clusterId: i % 5 === 3 ? 2 : 1,
    clusterName: "",
    createdAt: NOW - Math.round((240 - i * 9 + r() * 4) * DAY),
    lastLoginAt: i % 7 === 4 ? null : NOW - Math.round(r() * 20 * DAY + i * 1800),
  };
});

let userSeq = 2000;
export function addUser(body: { username: string; email?: string; fullname?: string; clusterId: number }): AdminUser {
  const u: AdminUser = {
    id: ++userSeq,
    username: body.username,
    email: body.email ?? "",
    fullname: body.fullname ?? "",
    isOn: true,
    sitesCount: 0,
    clusterId: body.clusterId,
    clusterName: "",
    createdAt: Math.floor(Date.now() / 1000),
    lastLoginAt: null,
  };
  users.unshift(u);
  return userView(u);
}

export function userView(u: AdminUser): AdminUser {
  return { ...u, clusterName: clusterName(u.clusterId), sitesCount: sites.filter((s) => s.userId === u.id).length };
}

// ---------------------------------------------------------------- sites

const SUBS = ["www", "static", "img", "api", "shop", "cdn", "video", "docs", "m", "assets"];

function cnameOf(id: number) {
  const r = rng(id * 7919);
  const s = Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(r() * 31)]).join("");
  return `${s}.cdn.example.com`;
}

export const sites: AdminSite[] = Array.from({ length: 40 }, (_, i) => {
  const r = rng(i * 53 + 11);
  const owner = users[(i * 7) % users.length]!;
  const sub = SUBS[i % SUBS.length]!;
  const apex = `${owner.username}.${i % 4 === 1 ? "example.net" : "example.com"}`;
  const domains = sub === "www" ? [`www.${apex}`, apex] : [`${sub}.${apex}`];
  const status: SiteStatus = i === 9 ? "error" : [4, 17, 30].includes(i) ? "pending_dns" : [12, 26].includes(i) || !owner.isOn ? "disabled" : "active";
  const isOn = status !== "disabled";
  const bytes = status === "active" ? Math.round((0.4 + r() * 60) * 1024 ** 3) : 0;
  return {
    id: 501 + i,
    name: domains[0]!,
    domains,
    cname: cnameOf(501 + i),
    status,
    isOn,
    origins: [{ protocol: i % 3 === 0 ? "http" : "https", host: `origin.${apex}`, port: i % 3 === 0 ? 80 : 443 }],
    originHost: "",
    https: { enabled: i % 5 !== 2, certId: null, autoCert: true, forceRedirect: i % 2 === 0, hsts: false, http2: true, minTlsVersion: "1.2" },
    createdAt: NOW - Math.round((180 - i * 4 + r() * 3) * DAY),
    traffic24h: status === "active" ? { bytes, requests: Math.round(bytes / 92_000) } : null,
    dnsCheckedAt: NOW - Math.round(r() * 6 * HOUR),
    dnsChecks: [],
    userId: owner.id,
    username: owner.username,
    clusterId: owner.clusterId,
    clusterName: "",
  };
});

export function siteView(s: AdminSite): AdminSite {
  return { ...s, clusterName: clusterName(s.clusterId) };
}

// ---------------------------------------------------------------- certs

const ISSUERS = ["Let's Encrypt R11", "Let's Encrypt R10", "ZeroSSL ECC Domain Secure Site CA", "Sectigo RSA Domain Validation"];
const EXPIRY_DAYS = [74, 61, 5, 88, 43, 12, -3, 29, 80, 66, 2, 51, 89, 37, 19, 70, 58, 24];

export const certs: AdminCert[] = EXPIRY_DAYS.map((days, i) => {
  const site = sites[(i * 2) % sites.length]!;
  const acme = i % 4 !== 3;
  const notAfter = NOW + days * DAY - 3600 * (i % 5);
  return {
    id: 301 + i,
    name: site.domains[0]!,
    domains: i % 6 === 0 ? [site.domains[0]!, `*.${site.domains[0]!.split(".").slice(1).join(".")}`] : [...site.domains],
    issuer: acme ? ISSUERS[i % 2]! : ISSUERS[2 + (i % 2)]!,
    notBefore: notAfter - (acme ? 90 : 365) * DAY,
    notAfter,
    isAcme: acme,
    autoRenew: acme,
    sitesCount: 1,
    status: days < 0 ? "expired" : days <= 14 ? "expiring" : "valid",
    userId: site.userId,
    username: site.username,
  };
});

// ---------------------------------------------------------------- DNS

export const providers: DnsProvider[] = [{ id: 1, name: "Cloudflare 主账号", type: "cloudflare", domainsCount: 0, createdAt: NOW - 200 * DAY }];

export const domains: DnsDomain[] = [
  { id: 1, name: "example.com", providerId: 1, providerName: "Cloudflare 主账号", isOn: true, recordsCount: 14, syncedAt: NOW - 18 * 60 },
  { id: 2, name: "example.net", providerId: 1, providerName: "Cloudflare 主账号", isOn: true, recordsCount: 3, syncedAt: NOW - 2 * DAY - 5 * HOUR },
];

export function providerView(p: DnsProvider): DnsProvider {
  return { ...p, domainsCount: domains.filter((d) => d.providerId === p.id).length };
}

// ---------------------------------------------------------------- settings

export let settings: SystemSettings = {
  productName: "Hcdn",
  consoleUrl: "https://console.example.com",
  registration: { open: true, defaultClusterId: 1, requireEmailVerification: true },
  adminIpAllowlist: ["203.0.113.0/24", "2001:db8:ff::/48"],
  smtp: { host: "smtp.example.com", port: 465, username: "noreply@example.com", from: "Hcdn <noreply@example.com>", configured: true },
};

export function setSettings(next: SystemSettings) {
  settings = next;
}

// ---------------------------------------------------------------- audit logs

type LogSeed = Omit<AuditLog, "id" | "time">;
const LOG_TEMPLATES: ((i: number) => LogSeed)[] = [
  () => ({ actorType: "admin", actor: "admin", action: "登录管理后台", ip: "203.0.113.5", level: "info" }),
  (i) => ({ actorType: "user", actor: users[i % users.length]!.username, action: "登录控制台", ip: `198.51.100.${40 + (i % 50)}`, level: "info" }),
  (i) => ({ actorType: "user", actor: users[(i * 3) % users.length]!.username, action: `添加网站 ${sites[i % sites.length]!.domains[0]}`, ip: `198.51.100.${60 + (i % 30)}`, level: "info" }),
  (i) => ({ actorType: "user", actor: users[(i * 5) % users.length]!.username, action: `刷新缓存 ${2 + (i % 9)} 个 URL`, ip: `198.51.100.${90 + (i % 20)}`, level: "info" }),
  () => ({ actorType: "system", actor: "edge-api", action: "节点 hkg-01 心跳超时，标记为离线", ip: "", level: "error" }),
  (i) => ({ actorType: "system", actor: "acme", action: `证书已自动续期：${certs[i % certs.length]!.domains[0]}`, ip: "", level: "info" }),
  (i) => ({ actorType: "admin", actor: "ops", action: `禁用用户 ${users[(i * 2) % users.length]!.username}`, ip: "203.0.113.8", level: "warning" }),
  () => ({ actorType: "admin", actor: "admin", action: "修改系统设置：注册", ip: "203.0.113.5", level: "warning" }),
  (i) => ({ actorType: "user", actor: users[(i * 11) % users.length]!.username, action: "登录失败：密码错误", ip: `2001:db8:5::${(i % 90) + 10}`, level: "warning" }),
  () => ({ actorType: "system", actor: "dns", action: "同步域名 example.com 解析记录", ip: "", level: "info" }),
  (i) => ({ actorType: "system", actor: "acme", action: `证书续期失败：${certs[6]!.domains[0]}（HTTP-01 校验未通过）`, ip: "", level: i % 2 ? "error" : "warning" }),
  () => ({ actorType: "admin", actor: "ops", action: "添加节点 tyo-03", ip: "203.0.113.8", level: "info" }),
];

const OFFLINE_TPL = 4;
export const auditLogs: AuditLog[] = Array.from({ length: 136 }, (_, i) => {
  const r = rng(i * 17 + 3);
  // Knuth multiplicative hash spreads the templates; the outage is logged exactly once (~3h ago).
  let k = (Math.imul(i + 1, 2654435761) >>> 0) % LOG_TEMPLATES.length;
  if (k === OFFLINE_TPL) k = (k + 1 + (i % 3)) % LOG_TEMPLATES.length;
  if (i === 9) k = OFFLINE_TPL;
  return { id: 9000 - i, time: NOW - i * 1260 - Math.round(r() * 600), ...LOG_TEMPLATES[k]!(i) };
});

let logSeq = 9001;
export function audit(action: string, level: AuditLog["level"] = "info") {
  auditLogs.unshift({ id: logSeq++, time: Math.floor(Date.now() / 1000), actorType: "admin", actor: me.username, action, ip: "203.0.113.5", level });
}

// ---------------------------------------------------------------- dashboard

export function dashboard(range: TimeRange): AdminDashboard {
  const s = series(range, 1, 42);
  const prev = series(range, 0.9, 43);
  const views = nodes.map(nodeView);
  const online = views.filter((n) => n.isOn && n.isUp).length;
  const regionsRaw = [
    { code: "JP", name: "日本", w: 0.31 },
    { code: "CN", name: "中国", w: 0.16 },
    { code: "US", name: "美国", w: 0.14 },
    { code: "KR", name: "韩国", w: 0.09 },
    { code: "TW", name: "中国台湾", w: 0.08 },
    { code: "SG", name: "新加坡", w: 0.07 },
    { code: "HK", name: "中国香港", w: 0.06 },
    { code: "AU", name: "澳大利亚", w: 0.05 },
    { code: "TH", name: "泰国", w: 0.04 },
  ];
  const t = totals(s);
  const alerts: AdminAlert[] = [
    { id: "a1", level: "critical", title: "节点离线", message: "hkg-01（198.51.100.31）已 3 小时无心跳", time: NOW - 3 * HOUR - 840 },
    { id: "a2", level: "warning", title: "CPU 使用率偏高", message: "tyo-03 CPU 持续 15 分钟高于 80%", time: NOW - 22 * 60 },
    { id: "a3", level: "warning", title: "证书即将过期", message: `${certs.filter((c) => c.status === "expiring").length} 张证书将在 14 天内过期`, time: NOW - 2 * HOUR },
    { id: "a4", level: "info", title: "新版本可用", message: "edge-node 1.4.2 已发布，hkg-01 仍为 1.4.0", time: NOW - DAY - 4 * HOUR },
  ];
  return {
    range,
    step: RANGE[range].step,
    totals: t,
    previous: totals(prev),
    series: s,
    statusCodes: [
      { code: "2xx", count: Math.round(t.requests * 0.9) },
      { code: "3xx", count: Math.round(t.requests * 0.06) },
      { code: "4xx", count: Math.round(t.requests * 0.035) },
      { code: "5xx", count: Math.round(t.requests * 0.005) },
    ],
    regions: regionsRaw.map((x) => ({ code: x.code, name: x.name, bytes: Math.round(t.bytes * x.w), requests: Math.round(t.requests * x.w) })),
    topSites: sites
      .filter((x) => x.traffic24h)
      .sort((a, b) => b.traffic24h!.bytes - a.traffic24h!.bytes)
      .slice(0, 6)
      .map((x) => ({ siteId: x.id, domain: x.domains[0]!, bytes: x.traffic24h!.bytes, requests: x.traffic24h!.requests })),
    nodes: { total: views.length, online, offline: views.filter((n) => n.isOn && !n.isUp).length },
    users: { total: users.length, newThisWeek: 3 },
    sitesCount: sites.length,
    certsExpiringSoon: certs.filter((c) => c.status === "expiring").length,
    nodeHealth: [...views].sort((a, b) => Number(b.isUp) - Number(a.isUp) || (b.bandwidthBps ?? 0) - (a.bandwidthBps ?? 0)),
    alerts,
  };
}

export function emptyDashboard(range: TimeRange): AdminDashboard {
  const zero = { bytes: 0, cachedBytes: 0, requests: 0, cachedRequests: 0, attackRequests: 0, peakBandwidthBps: 0 };
  return {
    range,
    step: RANGE[range].step,
    totals: zero,
    previous: null,
    series: [],
    statusCodes: [],
    regions: [],
    topSites: [],
    nodes: { total: 0, online: 0, offline: 0 },
    users: { total: 0, newThisWeek: 0 },
    sitesCount: 0,
    certsExpiringSoon: 0,
    nodeHealth: [],
    alerts: [],
  };
}
