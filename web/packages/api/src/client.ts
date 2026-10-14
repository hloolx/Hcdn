import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
    this.retryAfter = retryAfter ?? null;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ClientOptions {
  /** e.g. "/api/v1" or "/api/admin/v1" */
  base: string;
  /** Called on HTTP 401 (session missing/expired). */
  onUnauthorized?: () => void;
}

const CSRF_COOKIE = "hcdn_csrf";
const CSRF_HEADER = "X-CSRF-Token";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&") + "=([^;]*)"));
  return m?.[1] ? decodeURIComponent(m[1]) : "";
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

export function createClient(opts: ClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown, query?: Query, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && method !== "HEAD") {
      const token = readCookie(CSRF_COOKIE);
      if (token) headers[CSRF_HEADER] = token;
    }
    let res: Response;
    try {
      res = await fetch(withQuery(opts.base + path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError(0, "network", "网络连接失败，请检查网络后重试");
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      if (res.status === 401) opts.onUnauthorized?.();
      const err = (data as ApiErrorBody | null)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? `http_${res.status}`,
        err?.message ?? (res.status >= 500 ? "服务暂时不可用，请稍后重试" : `请求失败（${res.status}）`),
        err?.fields,
        err?.retryAfter,
      );
    }
    return data as T;
  }

  return {
    get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", path, undefined, query, signal),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
    del: <T = void>(path: string) => request<T>("DELETE", path),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
