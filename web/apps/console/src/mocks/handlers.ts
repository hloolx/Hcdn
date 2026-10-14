import { delay, http, HttpResponse } from "msw";
import type { Page, PublicConfig, TimeRange } from "@hcdn/api/types";
import * as db from "./data";

const B = "/api/v1";
let loggedIn = true;

function page<T>(items: T[], url: URL): Page<T> {
  const p = Number(url.searchParams.get("page") ?? 1);
  const size = Number(url.searchParams.get("pageSize") ?? 20);
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}

function err(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

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
  http.get(`${B}/overview`, async ({ request }) => {
    await delay(250);
    const range = (new URL(request.url).searchParams.get("range") ?? "24h") as TimeRange;
    return HttpResponse.json(db.overview(range));
  }),
  http.get(`${B}/stats`, async ({ request }) => {
    await delay(250);
    const url = new URL(request.url);
    const range = (url.searchParams.get("range") ?? "24h") as TimeRange;
    const siteId = Number(url.searchParams.get("siteId") ?? 0);
    return HttpResponse.json(db.stats(range, siteId ? 0.3 : 1, 7 + siteId));
  }),
  http.get(`${B}/sites`, async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    const kw = (url.searchParams.get("keyword") ?? "").toLowerCase();
    const items = db.sites.filter((s) => !kw || s.domains.some((d) => d.includes(kw)));
    return HttpResponse.json(page(items, url));
  }),
  http.get(`${B}/sites/:id`, ({ params }) => {
    const s = db.sites.find((x) => x.id === Number(params.id));
    return s ? HttpResponse.json(s) : err(404, "not_found", "网站不存在");
  }),
  http.get(`${B}/certs`, ({ request }) => HttpResponse.json(page(db.certs, new URL(request.url)))),
];
