/**
 * Hcdn console-api contract.
 *
 * Shared by the web apps (typed client) and services/console-api (Go
 * implementation). Conventions:
 * - JSON bodies; timestamps are unix seconds; sizes in bytes; bandwidth in bits/s;
 *   ratios are 0..1.
 * - Success: HTTP 2xx with the documented body. Errors: HTTP 4xx/5xx with
 *   `ApiErrorBody`.
 * - Lists: `Page<T>` with `page` (1-based) and `pageSize` query params.
 * - Customer endpoints live under `/api/v1`, admin endpoints under `/api/admin/v1`
 *   (served on the admin host only).
 * - Auth is a session cookie (HttpOnly, Secure, SameSite=Strict). Unsafe methods
 *   must send header `X-CSRF-Token` equal to the `hcdn_csrf` cookie.
 */

export interface ApiErrorBody {
  error: {
    /** Stable machine code, e.g. "invalid_credentials", "otp_required", "rate_limited", "validation", "not_found", "forbidden". */
    code: string;
    message: string;
    /** Per-field validation messages. */
    fields?: Record<string, string>;
    /** Seconds until retry is allowed (rate limits / lockouts). */
    retryAfter?: number;
  };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type TimeRange = "1h" | "24h" | "7d" | "30d";

// ---------------------------------------------------------------- auth

export interface PublicConfig {
  productName: string;
  registrationOpen: boolean;
  emailVerificationRequired: boolean;
  passwordResetAvailable: boolean;
  /** Base domain customers CNAME to, e.g. "cdn.example.com". Empty when DNS is not configured yet. */
  cnameDomain: string;
}

export interface PlanSummary {
  id: string;
  name: string;
  trafficQuotaBytes: number | null;
  domainsQuota: number | null;
  expiresAt: number | null;
}

export interface Me {
  id: number;
  username: string;
  email: string;
  fullname: string;
  emailVerified: boolean;
  otpEnabled: boolean;
  createdAt: number;
  plan: PlanSummary;
}

export interface LoginRequest {
  username: string;
  password: string;
  /** Required when the previous attempt returned code "otp_required". */
  otp?: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  fullname?: string;
}

export interface RegisterResponse {
  me: Me | null;
  /** True when the account must verify its email before signing in. */
  pendingVerification: boolean;
}

// ---------------------------------------------------------------- stats

export interface TrafficPoint {
  t: number;
  bytes: number;
  cachedBytes: number;
  requests: number;
  cachedRequests: number;
  attackRequests: number;
  /** Average bandwidth over the bucket, bits/s. */
  bandwidthBps: number;
}

export interface TrafficTotals {
  bytes: number;
  cachedBytes: number;
  requests: number;
  cachedRequests: number;
  attackRequests: number;
  peakBandwidthBps: number;
}

export interface StatusCodeCount {
  /** "2xx" | "3xx" | "4xx" | "5xx" */
  code: string;
  count: number;
}

export interface RegionStat {
  /** ISO 3166-1 alpha-2, e.g. "JP". Empty when unknown. */
  code: string;
  name: string;
  bytes: number;
  requests: number;
}

export interface TopSite {
  siteId: number;
  domain: string;
  bytes: number;
  requests: number;
}

export interface StatsReport {
  range: TimeRange;
  /** Bucket size of `series` in seconds (300, 3600 or 86400). */
  step: number;
  totals: TrafficTotals;
  /** Same metrics for the previous period of equal length (for deltas). */
  previous: TrafficTotals | null;
  series: TrafficPoint[];
  /** Empty when the backend has no status-code breakdown (current EdgeAPI). */
  statusCodes: StatusCodeCount[];
  regions: RegionStat[];
  topSites: TopSite[];
}

export interface Overview extends StatsReport {
  sites: { total: number; active: number; pendingDns: number; disabled: number };
  certs: { total: number; expiringSoon: number };
}

// ---------------------------------------------------------------- sites

export type SiteStatus = "active" | "pending_dns" | "disabled" | "error";

export interface Origin {
  protocol: "http" | "https";
  host: string;
  port: number;
  weight?: number;
}

export interface SiteHttps {
  enabled: boolean;
  certId: number | null;
  /** Request/renew a certificate automatically (ACME HTTP-01 through the edge). */
  autoCert: boolean;
  forceRedirect: boolean;
  hsts: boolean;
  http2: boolean;
  minTlsVersion: "1.0" | "1.1" | "1.2" | "1.3";
}

export interface DnsCheck {
  domain: string;
  ok: boolean;
  /** CNAME target or A/AAAA records found. */
  resolved: string[];
  message?: string;
}

export interface Site {
  id: number;
  name: string;
  domains: string[];
  /** The CNAME target the customer must point their domains at. */
  cname: string;
  status: SiteStatus;
  isOn: boolean;
  /** Empty in list responses (`GET /sites`); filled by `GET /sites/{id}`. */
  origins: Origin[];
  /** Host header sent to the origin; empty = the requested host. */
  originHost: string;
  https: SiteHttps;
  createdAt: number;
  /** null in list responses. */
  traffic24h: { bytes: number; requests: number } | null;
  dnsCheckedAt: number | null;
  dnsChecks: DnsCheck[];
}

export interface CreateSiteRequest {
  domains: string[];
  origins: Origin[];
  originHost?: string;
  autoCert: boolean;
  forceHttps: boolean;
  cachePreset: "static" | "dynamic" | "none";
}

export interface CacheRule {
  id: string;
  match: { type: "all" | "extension" | "path_prefix" | "regex"; value: string };
  ttlSeconds: number;
  ignoreQuery: boolean;
  enabled: boolean;
}

export interface CacheSettings {
  enabled: boolean;
  rules: CacheRule[];
}

export interface RateLimit {
  enabled: boolean;
  /** Max requests per client IP within `periodSeconds`. */
  requests: number;
  periodSeconds: number;
  blockSeconds: number;
}

export interface SecuritySettings {
  waf: { enabled: boolean; mode: "block" | "log" };
  ipAllow: string[];
  ipDeny: string[];
  /** ISO 3166-1 alpha-2 codes to block. */
  blockedCountries: string[];
  rateLimit: RateLimit;
}

export interface AccessLog {
  id: string;
  time: number;
  clientIp: string;
  /** Empty when unknown. */
  region: string;
  method: string;
  scheme: "http" | "https";
  host: string;
  path: string;
  status: number;
  bytes: number;
  durationMs: number;
  cache: "HIT" | "MISS" | "BYPASS" | "-";
  userAgent: string;
  referer: string;
  wafAction: string | null;
}

export interface AccessLogQuery {
  siteId?: number;
  from?: number;
  to?: number;
  status?: string;
  ip?: string;
  keyword?: string;
  cursor?: string;
  size?: number;
}

export interface AccessLogPage {
  items: AccessLog[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- certificates

export type CertStatus = "valid" | "expiring" | "expired" | "pending" | "error";

export interface Cert {
  id: number;
  name: string;
  domains: string[];
  issuer: string;
  notBefore: number;
  notAfter: number;
  isAcme: boolean;
  autoRenew: boolean;
  sitesCount: number;
  status: CertStatus;
}

export interface UploadCertRequest {
  name?: string;
  certPem: string;
  keyPem: string;
}

export interface AcmeRequest {
  domains: string[];
  siteId?: number;
}

export interface AcmeTask {
  id: number;
  domains: string[];
  status: "pending" | "running" | "success" | "failed";
  certId: number | null;
  error: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------- cache tasks

export interface CacheTask {
  id: number;
  type: "purge" | "preheat";
  keyType: "url" | "prefix";
  targets: string[];
  status: "pending" | "running" | "done" | "failed";
  createdAt: number;
  doneAt: number | null;
  done: number;
  total: number;
}

export interface PurgeRequest {
  keyType: "url" | "prefix";
  targets: string[];
}

export interface CacheQuota {
  maxKeysPerTask: number;
  maxKeysPerDay: number;
  usedToday: number;
}

// ---------------------------------------------------------------- account

export interface AccessKey {
  id: number;
  accessKeyId: string;
  description: string;
  isOn: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface CreatedAccessKey {
  key: AccessKey;
  /** Shown once. */
  secret: string;
}

export interface Plan {
  id: string;
  name: string;
  /** null = contact sales */
  priceMonthly: number | null;
  currency: "CNY" | "USD";
  trafficQuotaBytes: number | null;
  domainsQuota: number | null;
  features: string[];
  highlight: boolean;
}

export interface ActivityItem {
  id: number;
  time: number;
  action: string;
  ip: string;
}

// ---------------------------------------------------------------- admin

export interface AdminMe {
  id: number;
  username: string;
  fullname: string;
  isSuper: boolean;
}

export interface NodeSummary {
  id: number;
  name: string;
  clusterId: number;
  clusterName: string;
  ips: string[];
  isOn: boolean;
  /** Online (heartbeat + health check). */
  isUp: boolean;
  isInstalled: boolean;
  region: string;
  version: string;
  /** 0..1 */
  cpu: number | null;
  /** 0..1 */
  memory: number | null;
  load1: number | null;
  connections: number | null;
  /** Current outbound bandwidth, bits/s. */
  bandwidthBps: number | null;
  updatedAt: number | null;
}

export interface NodeDetail extends NodeSummary {
  series: { t: number; cpu: number; memory: number; bandwidthBps: number; connections: number }[];
  dnsRecords: string[];
}

export interface CreatedNode {
  node: NodeSummary;
  /** Node credentials for configs/api_node.yaml — shown once. */
  install: { nodeId: string; secret: string; endpoints: string[] };
}

export interface Cluster {
  id: number;
  name: string;
  nodesCount: number;
  onlineNodes: number;
  sitesCount: number;
  /** e.g. "cdn.example.com" when DNS is bound. */
  dnsDomain: string;
  dnsName: string;
  dnsProviderName: string;
  isDefault: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  fullname: string;
  isOn: boolean;
  sitesCount: number;
  clusterId: number;
  clusterName: string;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AdminSite extends Site {
  userId: number;
  username: string;
  clusterId: number;
  clusterName: string;
}

export interface AdminCert extends Cert {
  /** 0 / "" when unknown (the cross-tenant list only knows the owner when filtered by userId). */
  userId: number;
  username: string;
}

export interface DnsProvider {
  id: number;
  name: string;
  type: "cloudflare";
  domainsCount: number;
  createdAt: number;
}

export interface DnsDomain {
  id: number;
  name: string;
  providerId: number;
  providerName: string;
  isOn: boolean;
  recordsCount: number;
  syncedAt: number | null;
}

export interface SystemSettings {
  productName: string;
  consoleUrl: string;
  registration: { open: boolean; defaultClusterId: number; requireEmailVerification: boolean };
  adminIpAllowlist: string[];
  smtp: { host: string; port: number; username: string; from: string; configured: boolean };
}

export interface AuditLog {
  id: number;
  time: number;
  actorType: "admin" | "user" | "system";
  actor: string;
  action: string;
  ip: string;
  level: "info" | "warning" | "error";
}

export interface AdminAlert {
  id: string;
  level: "info" | "warning" | "critical";
  title: string;
  message: string;
  time: number;
}

export interface AdminDashboard extends StatsReport {
  nodes: { total: number; online: number; offline: number };
  users: { total: number; newThisWeek: number };
  sitesCount: number;
  certsExpiringSoon: number;
  nodeHealth: NodeSummary[];
  alerts: AdminAlert[];
}
