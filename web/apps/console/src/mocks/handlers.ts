import { delay, http, HttpResponse } from "msw";
import type {
  AccessLogQuery,
  CacheSettings,
  CreateSiteRequest,
  Origin,
  Page,
  PublicConfig,
  PurgeRequest,
  SecuritySettings,
  SiteHttps,
  TimeRange,
  UploadCertRequest,
} from "@hcdn/api/types";
import * as db from "./data";

const B = "/api/v1";
let loggedIn = true;

/**
 * QA scenarios: open any page with `?mock=empty` or `?mock=error` (persisted
 * for the tab in sessionStorage; `?mock=` resets) to see empty and failing
 * states without touching the code.
 */
function scenario(): "empty" | "error" | null {
  try {
    const v = sessionStorage.getItem("hcdn-mock");
    return v === "empty" || v === "error" ? v : null;
  } catch {
    return null;
  }
}

function page<T>(items: T[], url: URL): Page<T> {
  const p = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const size = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}

function err(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ error: { code, message, fields } }, { status });
}

const unavailable = () => err(503, "unavailable", "服务暂时不可用，请稍后重试");
const now = () => Math.floor(Date.now() / 1000);

function findSite(id: unknown) {
  return db.sites.find((x) => x.id === Number(id));
}

const notFound = () => err(404, "not_found", "网站不存在或已被删除");

export const handlers = [
  http.get(`${B}/public/config`, () =>
    HttpResponse.json<PublicConfig>({
      productName: "Hcdn",
      registrationOpen: true,
      emailVerificationRequired: false,
      passwordResetAvailable: true,
      cnameDomain: "cdn.example.com",
    }),
  ),
  http.get(`${B}/public/plans`, async () => {
    await delay(200);
    return HttpResponse.json(db.plans);
  }),

  // ------------------------------------------------------------ auth
  http.get(`${B}/auth/me`, async () => {
    await delay(150);
    return loggedIn ? HttpResponse.json(db.me) : err(401, "unauthorized", "未登录");
  }),
  http.post(`${B}/auth/login`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as { username: string; password: string };
    if (body.password !== "demo1234") return err(401, "invalid_credentials", "用户名或密码不正确");
    loggedIn = true;
    return HttpResponse.json(db.me);
  }),
  http.post(`${B}/auth/logout`, () => {
    loggedIn = false;
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${B}/auth/register`, async () => {
    await delay(500);
    loggedIn = true;
    return HttpResponse.json({ me: db.me, pendingVerification: false });
  }),
  http.post(`${B}/auth/password/forgot`, () => new HttpResponse(null, { status: 204 })),

  // ------------------------------------------------------------ dashboards
  http.get(`${B}/overview`, async ({ request }) => {
    await delay(250);
    if (scenario() === "error") return unavailable();
    const range = (new URL(request.url).searchParams.get("range") ?? "24h") as TimeRange;
    if (scenario() === "empty") {
      return HttpResponse.json({ ...db.emptyStats(range), sites: { total: 0, active: 0, pendingDns: 0, disabled: 0 }, certs: { total: 0, expiringSoon: 0 } });
    }
    return HttpResponse.json(db.overview(range));
  }),
  http.get(`${B}/stats`, async ({ request }) => {
    await delay(300);
    if (scenario() === "error") return unavailable();
    const url = new URL(request.url);
    const range = (url.searchParams.get("range") ?? "24h") as TimeRange;
    const siteId = Number(url.searchParams.get("siteId") ?? 0) || undefined;
    if (scenario() === "empty") return HttpResponse.json(db.emptyStats(range));
    return HttpResponse.json(db.stats(range, siteId));
  }),

  // ------------------------------------------------------------ sites
  http.get(`${B}/sites`, async ({ request }) => {
    await delay(250);
    if (scenario() === "error") return unavailable();
    const url = new URL(request.url);
    const kw = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    const items = scenario() === "empty" ? [] : db.sites.filter((s) => !kw || s.domains.some((d) => d.includes(kw)) || s.cname.includes(kw));
    return HttpResponse.json(page(items, url));
  }),
  http.post(`${B}/sites`, async ({ request }) => {
    await delay(700);
    const body = (await request.json()) as CreateSiteRequest;
    const used = db.allDomains();
    const dup = body.domains.find((d) => used.has(d));
    if (dup) return err(409, "conflict", `域名 ${dup} 已被其他网站使用`, { domains: `域名 ${dup} 已被其他网站使用` });
    const quota = db.me.plan.domainsQuota;
    if (quota != null && used.size + body.domains.length > quota) {
      return err(422, "quota_exceeded", `当前套餐最多可添加 ${quota} 个域名，已使用 ${used.size} 个`);
    }
    const site = db.createSite(body);
    db.logActivity(`添加网站 ${site.domains[0]}`);
    return HttpResponse.json(site, { status: 201 });
  }),
  http.get(`${B}/sites/:id`, async ({ params }) => {
    await delay(200);
    if (scenario() === "error") return unavailable();
    const s = findSite(params.id);
    return s ? HttpResponse.json(s) : notFound();
  }),
  http.patch(`${B}/sites/:id`, async ({ params, request }) => {
    await delay(400);
    const s = findSite(params.id);
    if (!s) return notFound();
    const body = (await request.json()) as { name?: string; isOn?: boolean };
    if (body.name != null) s.name = body.name;
    if (body.isOn != null) {
      s.isOn = body.isOn;
      if (!body.isOn && s.status === "active") s.status = "disabled";
      else if (body.isOn && s.status === "disabled") s.status = "active";
      db.logActivity(`${body.isOn ? "启用" : "停用"}网站 ${s.domains[0]}`);
    }
    return HttpResponse.json(s);
  }),
  http.delete(`${B}/sites/:id`, async ({ params }) => {
    await delay(500);
    const i = db.sites.findIndex((x) => x.id === Number(params.id));
    if (i < 0) return notFound();
    const [removed] = db.sites.splice(i, 1);
    db.logActivity(`删除网站 ${removed!.domains[0]}`);
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${B}/sites/:id/domains`, async ({ params, request }) => {
    await delay(500);
    const s = findSite(params.id);
    if (!s) return notFound();
    const { domains } = (await request.json()) as { domains: string[] };
    const used = db.allDomains(s.id);
    const dup = domains.find((d) => used.has(d));
    if (dup) return err(409, "conflict", `域名 ${dup} 已被其他网站使用`);
    const added = domains.filter((d) => !s.domains.includes(d));
    s.domains = domains;
    s.name = domains[0]!;
    s.dnsChecks = [
      ...s.dnsChecks.filter((c) => domains.includes(c.domain)),
      ...added.map((d) => ({ domain: d, ok: false, resolved: [], message: "尚未检测" })),
    ];
    if (added.length > 0 && s.status === "active") s.status = "pending_dns";
    return HttpResponse.json(s);
  }),
  http.put(`${B}/sites/:id/origins`, async ({ params, request }) => {
    await delay(500);
    const s = findSite(params.id);
    if (!s) return notFound();
    const body = (await request.json()) as { origins: Origin[]; originHost: string };
    s.origins = body.origins;
    s.originHost = body.originHost;
    return HttpResponse.json(s);
  }),
  http.post(`${B}/sites/:id/dns-check`, async ({ params }) => {
    await delay(1100);
    const s = findSite(params.id);
    if (!s) return notFound();
    const results = db.checkDns(s);
    return HttpResponse.json({ results, status: s.status });
  }),
  http.get(`${B}/sites/:id/https`, async ({ params }) => {
    await delay(200);
    if (scenario() === "error") return unavailable();
    const s = findSite(params.id);
    return s ? HttpResponse.json(s.https) : notFound();
  }),
  http.put(`${B}/sites/:id/https`, async ({ params, request }) => {
    await delay(500);
    const s = findSite(params.id);
    if (!s) return notFound();
    const body = (await request.json()) as SiteHttps;
    if (body.enabled && !body.autoCert && body.certId == null) return err(422, "validation", "请选择证书或开启自动申请", { certId: "请选择证书" });
    s.https = body;
    db.logActivity(`修改网站 ${s.domains[0]} 的 HTTPS 设置`);
    return HttpResponse.json(s.https);
  }),
  http.get(`${B}/sites/:id/cache`, async ({ params }) => {
    await delay(200);
    if (scenario() === "error") return unavailable();
    const s = findSite(params.id);
    if (!s) return notFound();
    return HttpResponse.json(db.cacheSettings.get(s.id) ?? { enabled: true, rules: [] });
  }),
  http.put(`${B}/sites/:id/cache`, async ({ params, request }) => {
    await delay(450);
    const s = findSite(params.id);
    if (!s) return notFound();
    const body = (await request.json()) as CacheSettings;
    db.cacheSettings.set(s.id, body);
    return HttpResponse.json(body);
  }),
  http.get(`${B}/sites/:id/security`, async ({ params }) => {
    await delay(200);
    if (scenario() === "error") return unavailable();
    const s = findSite(params.id);
    return s ? HttpResponse.json(db.security(s.id)) : notFound();
  }),
  http.put(`${B}/sites/:id/security`, async ({ params, request }) => {
    await delay(500);
    const s = findSite(params.id);
    if (!s) return notFound();
    const body = (await request.json()) as SecuritySettings;
    db.securitySettings.set(s.id, body);
    db.logActivity(`修改网站 ${s.domains[0]} 的安全设置`);
    return HttpResponse.json(body);
  }),
  http.get(`${B}/logs`, async ({ request }) => {
    await delay(350);
    if (scenario() === "error") return unavailable();
    if (scenario() === "empty") return HttpResponse.json({ items: [], nextCursor: null });
    const p = new URL(request.url).searchParams;
    const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
    const q: AccessLogQuery = {
      siteId: num("siteId"),
      from: num("from"),
      to: num("to"),
      status: p.get("status") ?? undefined,
      ip: p.get("ip") ?? undefined,
      keyword: p.get("keyword") ?? undefined,
      cursor: p.get("cursor") ?? undefined,
      size: num("size"),
    };
    return HttpResponse.json(db.queryLogs(q));
  }),

  // ------------------------------------------------------------ certificates
  http.get(`${B}/certs`, async ({ request }) => {
    await delay(250);
    if (scenario() === "error") return unavailable();
    const url = new URL(request.url);
    const kw = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    const items = scenario() === "empty" ? [] : db.certsWithUsage().filter((c) => !kw || c.domains.some((d) => d.includes(kw)) || c.name.includes(kw));
    return HttpResponse.json(page(items, url));
  }),
  http.post(`${B}/certs`, async ({ request }) => {
    await delay(600);
    const body = (await request.json()) as UploadCertRequest;
    if (!body.certPem.includes("BEGIN CERTIFICATE")) return err(422, "validation", "证书格式不正确", { certPem: "不是有效的 PEM 证书" });
    if (!/BEGIN (RSA |EC )?PRIVATE KEY/.test(body.keyPem)) return err(422, "validation", "私钥格式不正确", { keyPem: "不是有效的 PEM 私钥" });
    const t = now();
    const name = body.name?.trim() || "upload.example.com";
    const cert = db.addCert({ name, domains: [name], issuer: "Example Trust CA", notBefore: t - 86400, notAfter: t + 365 * 86400, isAcme: false, autoRenew: false });
    db.logActivity(`上传证书 ${name}`);
    return HttpResponse.json(cert, { status: 201 });
  }),
  http.delete(`${B}/certs/:id`, async ({ params }) => {
    await delay(450);
    const id = Number(params.id);
    const used = db.sites.filter((s) => s.https.certId === id);
    if (used.length > 0) return err(409, "in_use", `证书正被 ${used.length} 个网站使用，请先在网站的 HTTPS 设置中更换证书`);
    const i = db.certs.findIndex((c) => c.id === id);
    if (i < 0) return err(404, "not_found", "证书不存在");
    db.certs.splice(i, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${B}/certs/acme`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as { domains: string[] };
    if (!body.domains?.length) return err(422, "validation", "请至少选择一个域名");
    db.logActivity(`申请证书 ${body.domains[0]}`);
    return HttpResponse.json(db.createAcmeTask(body.domains), { status: 201 });
  }),
  http.get(`${B}/certs/acme/:id`, async ({ params }) => {
    await delay(150);
    const t = db.acmeTask(Number(params.id));
    return t ? HttpResponse.json(t) : err(404, "not_found", "任务不存在");
  }),

  // ------------------------------------------------------------ cache tasks
  http.post(`${B}/cache/purge`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as PurgeRequest;
    const q = db.cacheQuota;
    if (body.targets.length > q.maxKeysPerTask) return err(422, "validation", `单次最多提交 ${q.maxKeysPerTask} 条`);
    if (q.usedToday + body.targets.length > q.maxKeysPerDay) return err(429, "quota_exceeded", "今日刷新额度已用完");
    db.logActivity(`刷新缓存：${body.targets.length} 个${body.keyType === "url" ? " URL" : "目录"}`);
    return HttpResponse.json(db.addCacheTask("purge", body.keyType, body.targets), { status: 201 });
  }),
  http.post(`${B}/cache/preheat`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as { urls: string[] };
    const q = db.cacheQuota;
    if (body.urls.length > q.maxKeysPerTask) return err(422, "validation", `单次最多提交 ${q.maxKeysPerTask} 条`);
    if (q.usedToday + body.urls.length > q.maxKeysPerDay) return err(429, "quota_exceeded", "今日额度已用完");
    db.logActivity(`预热缓存：${body.urls.length} 个 URL`);
    return HttpResponse.json(db.addCacheTask("preheat", "url", body.urls), { status: 201 });
  }),
  http.get(`${B}/cache/tasks`, async ({ request }) => {
    await delay(250);
    if (scenario() === "error") return unavailable();
    const items = scenario() === "empty" ? [] : db.cacheTasks.map(db.publicTask);
    return HttpResponse.json(page(items, new URL(request.url)));
  }),
  http.get(`${B}/cache/quota`, async () => {
    await delay(150);
    if (scenario() === "error") return unavailable();
    return HttpResponse.json(scenario() === "empty" ? { ...db.cacheQuota, usedToday: 0 } : db.cacheQuota);
  }),

  // ------------------------------------------------------------ account
  http.put(`${B}/account`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as { fullname?: string; email?: string };
    if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return err(422, "validation", "邮箱格式不正确", { email: "邮箱格式不正确" });
    if (body.fullname != null) db.me.fullname = body.fullname;
    if (body.email != null && body.email !== db.me.email) {
      db.me.email = body.email;
      db.me.emailVerified = false;
    }
    db.logActivity("修改账号资料");
    return HttpResponse.json(db.me);
  }),
  http.put(`${B}/account/password`, async ({ request }) => {
    await delay(600);
    const body = (await request.json()) as { currentPassword: string; newPassword: string };
    if (body.currentPassword !== "demo1234") return err(422, "validation", "当前密码不正确", { currentPassword: "当前密码不正确" });
    db.logActivity("修改登录密码");
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${B}/account/access-keys`, async () => {
    await delay(250);
    if (scenario() === "error") return unavailable();
    return HttpResponse.json(scenario() === "empty" ? [] : db.accessKeys);
  }),
  http.post(`${B}/account/access-keys`, async ({ request }) => {
    await delay(500);
    const { description } = (await request.json()) as { description: string };
    if (db.accessKeys.length >= 10) return err(422, "quota_exceeded", "最多创建 10 个 API 密钥");
    db.logActivity("创建 API 密钥");
    return HttpResponse.json(db.createAccessKey(description), { status: 201 });
  }),
  http.patch(`${B}/account/access-keys/:id`, async ({ params, request }) => {
    await delay(300);
    const k = db.accessKeys.find((x) => x.id === Number(params.id));
    if (!k) return err(404, "not_found", "密钥不存在");
    const { isOn } = (await request.json()) as { isOn: boolean };
    k.isOn = isOn;
    return HttpResponse.json(k);
  }),
  http.delete(`${B}/account/access-keys/:id`, async ({ params }) => {
    await delay(400);
    const i = db.accessKeys.findIndex((x) => x.id === Number(params.id));
    if (i < 0) return err(404, "not_found", "密钥不存在");
    db.accessKeys.splice(i, 1);
    db.logActivity("删除 API 密钥");
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(`${B}/account/activity`, async () => {
    await delay(250);
    if (scenario() === "error") return unavailable();
    return HttpResponse.json(scenario() === "empty" ? [] : db.activity.slice(0, 20));
  }),
];
