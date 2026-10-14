import { createClient, type ClientOptions } from "./client";
import type {
  AdminCert,
  AdminDashboard,
  AdminMe,
  AdminSite,
  AdminUser,
  AuditLog,
  Cluster,
  CreatedNode,
  DnsDomain,
  DnsProvider,
  LoginRequest,
  NodeDetail,
  NodeSummary,
  Page,
  SystemSettings,
  TimeRange,
} from "./types";

type PageQuery = { keyword?: string; page?: number; pageSize?: number };

/** Admin console API (`/api/admin/v1`). */
export function createAdminApi(opts: Partial<ClientOptions> = {}) {
  const c = createClient({ base: "/api/admin/v1", ...opts });
  return {
    // auth
    me: () => c.get<AdminMe>("/auth/me"),
    login: (body: LoginRequest) => c.post<AdminMe>("/auth/login", body),
    logout: () => c.post<void>("/auth/logout"),

    dashboard: (range: TimeRange) => c.get<AdminDashboard>("/dashboard", { range }),

    // nodes & clusters
    nodes: (q: PageQuery & { clusterId?: number; status?: "online" | "offline" | "disabled" } = {}) =>
      c.get<Page<NodeSummary>>("/nodes", q),
    node: (id: number) => c.get<NodeDetail>(`/nodes/${id}`),
    createNode: (body: { clusterId: number; name: string; ips: string[] }) => c.post<CreatedNode>("/nodes", body),
    updateNode: (id: number, body: { name?: string; isOn?: boolean; ips?: string[] }) => c.patch<NodeSummary>(`/nodes/${id}`, body),
    deleteNode: (id: number) => c.del(`/nodes/${id}`),
    clusters: () => c.get<Cluster[]>("/clusters"),
    createCluster: (name: string) => c.post<Cluster>("/clusters", { name }),
    updateCluster: (id: number, body: { name?: string }) => c.patch<Cluster>(`/clusters/${id}`, body),
    updateClusterDns: (id: number, body: { domainId: number; dnsName: string; ttl?: number }) => c.put<Cluster>(`/clusters/${id}/dns`, body),

    // users
    users: (q: PageQuery = {}) => c.get<Page<AdminUser>>("/users", q),
    createUser: (body: { username: string; password: string; email?: string; fullname?: string; clusterId: number }) =>
      c.post<AdminUser>("/users", body),
    updateUser: (id: number, body: { isOn?: boolean; fullname?: string; email?: string; clusterId?: number }) =>
      c.patch<AdminUser>(`/users/${id}`, body),
    resetUserPassword: (id: number, password: string) => c.post<void>(`/users/${id}/reset-password`, { password }),
    deleteUser: (id: number) => c.del(`/users/${id}`),

    // resources across tenants
    sites: (q: PageQuery & { userId?: number } = {}) => c.get<Page<AdminSite>>("/sites", q),
    updateSite: (id: number, body: { isOn: boolean }) => c.patch<AdminSite>(`/sites/${id}`, body),
    certs: (q: PageQuery = {}) => c.get<Page<AdminCert>>("/certs", q),

    // DNS
    dnsProviders: () => c.get<DnsProvider[]>("/dns/providers"),
    createDnsProvider: (body: { name: string; type: "cloudflare"; apiToken: string }) => c.post<DnsProvider>("/dns/providers", body),
    deleteDnsProvider: (id: number) => c.del(`/dns/providers/${id}`),
    dnsDomains: () => c.get<DnsDomain[]>("/dns/domains"),
    createDnsDomain: (body: { providerId: number; name: string }) => c.post<DnsDomain>("/dns/domains", body),
    syncDnsDomain: (id: number) => c.post<DnsDomain>(`/dns/domains/${id}/sync`),

    // settings & audit
    settings: () => c.get<SystemSettings>("/settings"),
    updateSettings: (body: Partial<SystemSettings>) => c.put<SystemSettings>("/settings", body),
    auditLogs: (q: PageQuery & { actorType?: string } = {}) => c.get<Page<AuditLog>>("/audit-logs", q),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
