import { createClient, type ClientOptions } from "./client";
import type {
  AccessKey,
  AccessLogPage,
  AccessLogQuery,
  AcmeRequest,
  AcmeTask,
  ActivityItem,
  CacheQuota,
  CacheSettings,
  CacheTask,
  Cert,
  CreatedAccessKey,
  CreateSiteRequest,
  DnsCheck,
  LoginRequest,
  Me,
  Origin,
  Overview,
  Page,
  Plan,
  PublicConfig,
  PurgeRequest,
  RegisterRequest,
  RegisterResponse,
  SecuritySettings,
  Site,
  SiteHttps,
  StatsReport,
  TimeRange,
  UploadCertRequest,
} from "./types";

/** Customer console API (`/api/v1`). */
export function createConsoleApi(opts: Partial<ClientOptions> = {}) {
  const c = createClient({ base: "/api/v1", ...opts });
  return {
    // public
    config: () => c.get<PublicConfig>("/public/config"),
    plans: () => c.get<Plan[]>("/public/plans"),

    // auth
    me: () => c.get<Me>("/auth/me"),
    login: (body: LoginRequest) => c.post<Me>("/auth/login", body),
    register: (body: RegisterRequest) => c.post<RegisterResponse>("/auth/register", body),
    logout: () => c.post<void>("/auth/logout"),
    forgotPassword: (email: string, turnstileToken?: string) => c.post<void>("/auth/password/forgot", { email, turnstileToken }),
    resetPassword: (token: string, password: string) => c.post<void>("/auth/password/reset", { token, password }),
    verifyEmail: (token: string) => c.post<void>("/auth/email/verify", { token }),

    // dashboards
    overview: (range: TimeRange) => c.get<Overview>("/overview", { range }),
    stats: (range: TimeRange, siteId?: number) => c.get<StatsReport>("/stats", { range, siteId }),

    // sites
    sites: (q: { keyword?: string; page?: number; pageSize?: number } = {}) => c.get<Page<Site>>("/sites", q),
    site: (id: number) => c.get<Site>(`/sites/${id}`),
    createSite: (body: CreateSiteRequest) => c.post<Site>("/sites", body),
    updateSite: (id: number, body: { name?: string; isOn?: boolean }) => c.patch<Site>(`/sites/${id}`, body),
    updateDomains: (id: number, domains: string[]) => c.put<Site>(`/sites/${id}/domains`, { domains }),
    updateOrigins: (id: number, origins: Origin[], originHost: string) => c.put<Site>(`/sites/${id}/origins`, { origins, originHost }),
    deleteSite: (id: number) => c.del(`/sites/${id}`),
    checkDns: (id: number) => c.post<{ results: DnsCheck[]; status: Site["status"] }>(`/sites/${id}/dns-check`),
    https: (id: number) => c.get<SiteHttps>(`/sites/${id}/https`),
    updateHttps: (id: number, body: SiteHttps) => c.put<SiteHttps>(`/sites/${id}/https`, body),
    cache: (id: number) => c.get<CacheSettings>(`/sites/${id}/cache`),
    updateCache: (id: number, body: CacheSettings) => c.put<CacheSettings>(`/sites/${id}/cache`, body),
    security: (id: number) => c.get<SecuritySettings>(`/sites/${id}/security`),
    updateSecurity: (id: number, body: SecuritySettings) => c.put<SecuritySettings>(`/sites/${id}/security`, body),
    logs: (q: AccessLogQuery) => c.get<AccessLogPage>("/logs", { ...q }),

    // certificates
    certs: (q: { keyword?: string; page?: number; pageSize?: number } = {}) => c.get<Page<Cert>>("/certs", q),
    uploadCert: (body: UploadCertRequest) => c.post<Cert>("/certs", body),
    deleteCert: (id: number) => c.del(`/certs/${id}`),
    requestAcme: (body: AcmeRequest) => c.post<AcmeTask>("/certs/acme", body),
    acmeTask: (id: number) => c.get<AcmeTask>(`/certs/acme/${id}`),

    // cache tasks
    purge: (body: PurgeRequest) => c.post<CacheTask>("/cache/purge", body),
    preheat: (urls: string[]) => c.post<CacheTask>("/cache/preheat", { urls }),
    cacheTasks: (q: { page?: number; pageSize?: number } = {}) => c.get<Page<CacheTask>>("/cache/tasks", q),
    cacheQuota: () => c.get<CacheQuota>("/cache/quota"),

    // account
    updateProfile: (body: { fullname?: string; email?: string }) => c.put<Me>("/account", body),
    changePassword: (currentPassword: string, newPassword: string) =>
      c.put<void>("/account/password", { currentPassword, newPassword }),
    accessKeys: () => c.get<AccessKey[]>("/account/access-keys"),
    createAccessKey: (description: string) => c.post<CreatedAccessKey>("/account/access-keys", { description }),
    updateAccessKey: (id: number, isOn: boolean) => c.patch<AccessKey>(`/account/access-keys/${id}`, { isOn }),
    deleteAccessKey: (id: number) => c.del(`/account/access-keys/${id}`),
    activity: () => c.get<ActivityItem[]>("/account/activity"),
  };
}

export type ConsoleApi = ReturnType<typeof createConsoleApi>;
