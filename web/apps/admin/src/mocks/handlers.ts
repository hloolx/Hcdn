import { delay, http, HttpResponse } from "msw";
import type { AdminSite, Page, SystemSettings, TimeRange } from "@hcdn/api/types";
import * as db from "./data";

const B = "/api/admin/v1";
let loggedIn = true;
let failures = 0;
let lockedUntil = 0;

/** QA scenario chosen with `?mock=empty|error` (see main.tsx). */
function scenario(): "empty" | "error" | null {
  const v = sessionStorage.getItem("hcdn-mock");
  return v === "empty" || v === "error" ? v : null;
}

function page<T>(items: T[], url: URL): Page<T> {
  const p = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const size = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}

function err(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return HttpResponse.json({ error: { code, message, ...extra } }, { status });
}

const noContent = () => new HttpResponse(null, { status: 204 });

/** Wraps a read handler with the QA scenarios: error → 500, empty → `empty` (undefined = keep real data). */
function read<T>(empty: T, fn: (url: URL, params: Record<string, string | readonly string[] | undefined>) => Response | Promise<Response>) {
  return async ({ request, params }: { request: Request; params: Record<string, string | readonly string[] | undefined> }) => {
    await delay(180 + Math.round(Math.random() * 120));
    const s = scenario();
    if (s === "error") return err(500, "internal", "服务暂时不可用，请稍后重试");
    if (s === "empty" && empty !== undefined) return HttpResponse.json(empty);
    return fn(new URL(request.url), params);
  };
}

const emptyPage = { items: [], total: 0, page: 1, pageSize: 20 };
const kw = (url: URL) => (url.searchParams.get("keyword") ?? "").trim().toLowerCase();

export const handlers = [
  // ------------------------------------------------------------ auth
  http.get(`${B}/auth/me`, async () => {
    await delay(120);
    return loggedIn ? HttpResponse.json(db.me) : err(401, "unauthorized", "未登录");
  }),
  http.post(`${B}/auth/login`, async ({ request }) => {
    await delay(450);
    const body = (await request.json()) as { username: string; password: string; otp?: string };
    const now = Date.now() / 1000;
    if (body.username === "locked" || lockedUntil > now) {
      const retryAfter = lockedUntil > now ? Math.ceil(lockedUntil - now) : 900;
      return err(429, "rate_limited", "尝试次数过多", { retryAfter });
    }
    if (body.password !== "demo1234") {
      failures++;
      if (failures >= 5) {
        lockedUntil = now + 900;
        failures = 0;
        return err(429, "rate_limited", "尝试次数过多", { retryAfter: 900 });
      }
      return err(401, "invalid_credentials", "用户名或密码不正确");
    }
    if (body.username === "ops") {
      if (!body.otp) return err(401, "otp_required", "需要两步验证");
      if (body.otp !== "123456") return err(401, "invalid_otp", "验证码不正确");
    }
    failures = 0;
    loggedIn = true;
    return HttpResponse.json({ ...db.me, username: body.username || db.me.username });
  }),
  http.post(`${B}/auth/logout`, () => {
    loggedIn = false;
    return noContent();
  }),

  // ------------------------------------------------------------ dashboard
  http.get(
    `${B}/dashboard`,
    read(undefined, (url) => {
      const range = (url.searchParams.get("range") ?? "24h") as TimeRange;
      return HttpResponse.json(scenario() === "empty" ? db.emptyDashboard(range) : db.dashboard(range));
    }),
  ),

  // ------------------------------------------------------------ nodes
  http.get(
    `${B}/nodes`,
    read(emptyPage, (url) => {
      const k = kw(url);
      const clusterId = Number(url.searchParams.get("clusterId") ?? 0);
      const status = url.searchParams.get("status");
      const items = db.nodes
        .map(db.nodeView)
        .filter((n) => !clusterId || n.clusterId === clusterId)
        .filter((n) => {
          if (status === "online") return n.isOn && n.isUp;
          if (status === "offline") return n.isOn && !n.isUp;
          if (status === "disabled") return !n.isOn;
          return true;
        })
        .filter((n) => !k || n.name.toLowerCase().includes(k) || n.ips.some((ip) => ip.includes(k)) || n.region.toLowerCase().includes(k));
      return HttpResponse.json(page(items, url));
    }),
  ),
  http.get(
    `${B}/nodes/:id`,
    read(undefined, (_url, params) => {
      const n = db.nodes.find((x) => x.id === Number(params.id));
      return n ? HttpResponse.json(db.nodeDetail(n)) : err(404, "not_found", "节点不存在");
    }),
  ),
  http.post(`${B}/nodes`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as { clusterId: number; name: string; ips: string[] };
    if (db.nodes.some((n) => n.name === body.name)) return err(409, "conflict", "节点名称已存在", { fields: { name: "节点名称已存在" } });
    db.audit(`添加节点 ${body.name}`);
    return HttpResponse.json(db.newNode(body.clusterId, body.name, body.ips), { status: 201 });
  }),
  http.patch(`${B}/nodes/:id`, async ({ request, params }) => {
    await delay(300);
    const n = db.nodes.find((x) => x.id === Number(params.id));
    if (!n) return err(404, "not_found", "节点不存在");
    const body = (await request.json()) as { name?: string; isOn?: boolean; ips?: string[] };
    Object.assign(n, body);
    if (body.isOn !== undefined) db.audit(`${body.isOn ? "启用" : "停用"}节点 ${n.name}`, body.isOn ? "info" : "warning");
    return HttpResponse.json(db.nodeView(n));
  }),
  http.delete(`${B}/nodes/:id`, async ({ params }) => {
    await delay(400);
    const i = db.nodes.findIndex((x) => x.id === Number(params.id));
    if (i < 0) return err(404, "not_found", "节点不存在");
    db.audit(`删除节点 ${db.nodes[i]!.name}`, "warning");
    db.nodes.splice(i, 1);
    return noContent();
  }),

  // ------------------------------------------------------------ clusters
  http.get(`${B}/clusters`, read([], () => HttpResponse.json(db.clusterRows.map(db.clusterView)))),
  http.post(`${B}/clusters`, async ({ request }) => {
    await delay(350);
    const { name } = (await request.json()) as { name: string };
    if (db.clusterRows.some((c) => c.name === name)) return err(409, "conflict", "集群名称已存在");
    const row = { id: Math.max(...db.clusterRows.map((c) => c.id)) + 1, name, domainId: null, dnsName: "", ttl: 300, isDefault: false };
    db.clusterRows.push(row);
    db.audit(`创建集群 ${name}`);
    return HttpResponse.json(db.clusterView(row), { status: 201 });
  }),
  http.patch(`${B}/clusters/:id`, async ({ request, params }) => {
    const row = db.clusterRows.find((c) => c.id === Number(params.id));
    if (!row) return err(404, "not_found", "集群不存在");
    const body = (await request.json()) as { name?: string };
    if (body.name) row.name = body.name;
    return HttpResponse.json(db.clusterView(row));
  }),
  http.put(`${B}/clusters/:id/dns`, async ({ request, params }) => {
    await delay(500);
    const row = db.clusterRows.find((c) => c.id === Number(params.id));
    if (!row) return err(404, "not_found", "集群不存在");
    const body = (await request.json()) as { domainId: number; dnsName: string; ttl?: number };
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(body.dnsName)) return err(422, "validation", "子域名格式不正确", { fields: { dnsName: "子域名格式不正确" } });
    row.domainId = body.domainId;
    row.dnsName = body.dnsName;
    row.ttl = body.ttl ?? 300;
    db.audit(`修改集群 ${row.name} 的 DNS 设置`, "warning");
    return HttpResponse.json(db.clusterView(row));
  }),

  // ------------------------------------------------------------ users
  http.get(
    `${B}/users`,
    read(emptyPage, (url) => {
      const k = kw(url);
      const items = db.users
        .filter((u) => !k || u.username.includes(k) || u.email.toLowerCase().includes(k) || u.fullname.toLowerCase().includes(k))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(db.userView);
      return HttpResponse.json(page(items, url));
    }),
  ),
  http.post(`${B}/users`, async ({ request }) => {
    await delay(450);
    const body = (await request.json()) as { username: string; password: string; email?: string; fullname?: string; clusterId: number };
    if (db.users.some((u) => u.username === body.username)) return err(409, "conflict", "用户名已存在", { fields: { username: "用户名已存在" } });
    db.audit(`创建用户 ${body.username}`);
    return HttpResponse.json(db.addUser(body), { status: 201 });
  }),
  http.patch(`${B}/users/:id`, async ({ request, params }) => {
    await delay(250);
    const u = db.users.find((x) => x.id === Number(params.id));
    if (!u) return err(404, "not_found", "用户不存在");
    const body = (await request.json()) as Partial<{ isOn: boolean; fullname: string; email: string; clusterId: number }>;
    Object.assign(u, body);
    if (body.isOn !== undefined) db.audit(`${body.isOn ? "启用" : "禁用"}用户 ${u.username}`, body.isOn ? "info" : "warning");
    return HttpResponse.json(db.userView(u));
  }),
  http.post(`${B}/users/:id/reset-password`, async ({ params }) => {
    await delay(400);
    const u = db.users.find((x) => x.id === Number(params.id));
    if (!u) return err(404, "not_found", "用户不存在");
    db.audit(`重置用户 ${u.username} 的密码`, "warning");
    return noContent();
  }),
  http.delete(`${B}/users/:id`, async ({ params }) => {
    await delay(450);
    const i = db.users.findIndex((x) => x.id === Number(params.id));
    if (i < 0) return err(404, "not_found", "用户不存在");
    db.audit(`删除用户 ${db.users[i]!.username}`, "warning");
    db.users.splice(i, 1);
    return noContent();
  }),

  // ------------------------------------------------------------ sites & certs
  http.get(
    `${B}/sites`,
    read(emptyPage, (url) => {
      const k = kw(url);
      const userId = Number(url.searchParams.get("userId") ?? 0);
      const items: AdminSite[] = db.sites
        .filter((s) => !userId || s.userId === userId)
        .filter((s) => !k || s.domains.some((d) => d.includes(k)) || s.username.includes(k) || s.cname.includes(k))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(db.siteView);
      return HttpResponse.json(page(items, url));
    }),
  ),
  http.patch(`${B}/sites/:id`, async ({ request, params }) => {
    await delay(350);
    const s = db.sites.find((x) => x.id === Number(params.id));
    if (!s) return err(404, "not_found", "网站不存在");
    const { isOn } = (await request.json()) as { isOn: boolean };
    s.isOn = isOn;
    s.status = isOn ? "active" : "disabled";
    db.audit(`${isOn ? "启用" : "停用"}网站 ${s.domains[0]}`, isOn ? "info" : "warning");
    return HttpResponse.json(db.siteView(s));
  }),
  http.get(
    `${B}/certs`,
    read(emptyPage, (url) => {
      const k = kw(url);
      const items = db.certs
        .filter((c) => !k || c.domains.some((d) => d.includes(k)) || c.username.includes(k) || c.issuer.toLowerCase().includes(k))
        .sort((a, b) => a.notAfter - b.notAfter);
      return HttpResponse.json(page(items, url));
    }),
  ),

  // ------------------------------------------------------------ DNS
  http.get(`${B}/dns/providers`, read([], () => HttpResponse.json(db.providers.map(db.providerView)))),
  http.post(`${B}/dns/providers`, async ({ request }) => {
    await delay(700);
    const body = (await request.json()) as { name: string; type: "cloudflare"; apiToken: string };
    if (body.apiToken.length < 20) return err(422, "validation", "API Token 校验失败：Cloudflare 拒绝了该令牌", { fields: { apiToken: "令牌无效或权限不足" } });
    const p = { id: Math.max(0, ...db.providers.map((x) => x.id)) + 1, name: body.name, type: body.type, domainsCount: 0, createdAt: Math.floor(Date.now() / 1000) };
    db.providers.push(p);
    db.audit(`添加 DNS 服务商 ${body.name}`);
    return HttpResponse.json(p, { status: 201 });
  }),
  http.delete(`${B}/dns/providers/:id`, async ({ params }) => {
    await delay(350);
    const id = Number(params.id);
    if (db.domains.some((d) => d.providerId === id)) return err(409, "conflict", "该服务商下还有域名，请先移除域名");
    const i = db.providers.findIndex((p) => p.id === id);
    if (i >= 0) db.providers.splice(i, 1);
    return noContent();
  }),
  http.get(`${B}/dns/domains`, read([], () => HttpResponse.json(db.domains))),
  http.post(`${B}/dns/domains`, async ({ request }) => {
    await delay(600);
    const body = (await request.json()) as { providerId: number; name: string };
    const p = db.providers.find((x) => x.id === body.providerId);
    if (!p) return err(422, "validation", "请选择服务商");
    if (db.domains.some((d) => d.name === body.name)) return err(409, "conflict", "域名已存在", { fields: { name: "域名已存在" } });
    const d = { id: Math.max(0, ...db.domains.map((x) => x.id)) + 1, name: body.name, providerId: p.id, providerName: p.name, isOn: true, recordsCount: 0, syncedAt: null };
    db.domains.push(d);
    db.audit(`添加 DNS 域名 ${body.name}`);
    return HttpResponse.json(d, { status: 201 });
  }),
  http.post(`${B}/dns/domains/:id/sync`, async ({ params }) => {
    await delay(1100);
    const d = db.domains.find((x) => x.id === Number(params.id));
    if (!d) return err(404, "not_found", "域名不存在");
    d.syncedAt = Math.floor(Date.now() / 1000);
    d.recordsCount = Math.max(d.recordsCount, 2) + (d.name === "example.com" ? 0 : 1);
    return HttpResponse.json(d);
  }),

  // ------------------------------------------------------------ settings & audit
  http.get(`${B}/settings`, read(undefined, () => HttpResponse.json(db.settings))),
  http.put(`${B}/settings`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as Partial<SystemSettings>;
    db.setSettings({ ...db.settings, ...body, smtp: db.settings.smtp });
    db.audit("修改系统设置", "warning");
    return HttpResponse.json(db.settings);
  }),
  http.get(
    `${B}/audit-logs`,
    read(emptyPage, (url) => {
      const k = kw(url);
      const actorType = url.searchParams.get("actorType");
      const items = db.auditLogs
        .filter((l) => !actorType || l.actorType === actorType)
        .filter((l) => !k || l.action.toLowerCase().includes(k) || l.actor.toLowerCase().includes(k) || l.ip.includes(k));
      return HttpResponse.json(page(items, url));
    }),
  ),
];
