import type { Origin, Site, SiteStatus } from "@hcdn/api/types";
import type { StatusTone } from "@hcdn/ui/blocks/status";

/** Status presentation. Labels are t() keys. */
export const SITE_STATUS: Record<SiteStatus, { label: string; tone: StatusTone; pulse?: boolean; hint: string }> = {
  active: { label: "运行中", tone: "success", hint: "域名已解析到 CDN，正在加速" },
  pending_dns: { label: "待解析 CNAME", tone: "warning", pulse: true, hint: "请在 DNS 服务商处添加 CNAME 记录" },
  disabled: { label: "已停用", tone: "neutral", hint: "边缘节点不再为该网站提供服务" },
  error: { label: "异常", tone: "danger", hint: "源站无法访问或配置有误" },
};

export function originLabel(o: Origin): string {
  const host = o.host.includes(":") && !o.host.startsWith("[") ? `[${o.host}]` : o.host;
  const defaultPort = o.protocol === "https" ? 443 : 80;
  return `${o.protocol}://${host}${o.port === defaultPort ? "" : `:${o.port}`}`;
}

/**
 * The record name to create at the DNS provider, relative to the zone. We
 * don't know the zone, so assume the registrable domain is the last two labels.
 */
export function hostRecord(domain: string): { host: string; zone: string } {
  const labels = domain.split(".");
  if (labels.length <= 2) return { host: "@", zone: domain };
  return { host: labels.slice(0, -2).join("."), zone: labels.slice(-2).join(".") };
}

export function primaryDomain(site: Pick<Site, "domains" | "name">) {
  return site.domains[0] ?? site.name;
}
