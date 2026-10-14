import * as React from "react";
import { Link, Outlet, useNavigate, useOutletContext, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, CirclePause, Clock3, ExternalLink, Globe, Play, Trash2 } from "lucide-react";
import type { Site } from "@hcdn/api/types";
import { ApiError } from "@hcdn/api/client";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { CopyButton } from "@hcdn/ui/blocks/status";
import { Button } from "@hcdn/ui/components/button";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Hint } from "@hcdn/ui/components/tooltip";
import { formatDate } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { primaryDomain } from "@/lib/site";
import { RouteTabs } from "@/components/route-tabs";
import { SiteStatusBadge, useSiteActions } from "@/components/site-actions";

export interface SiteContext {
  site: Site;
}

export function useSite() {
  return useOutletContext<SiteContext>().site;
}

export function useSiteQuery(id: number) {
  return useQuery({ queryKey: ["site", id], queryFn: () => api.site(id), enabled: Number.isFinite(id) && id > 0 });
}

export function SiteLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = Number(useParams().id);
  const q = useSiteQuery(id);
  const actions = useSiteActions({ onDeleted: () => navigate("/sites", { replace: true }) });
  const site = q.data;

  const back = (
    <Link to="/sites" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" />
      {t("网站")}
    </Link>
  );

  if (q.isPending) {
    return (
      <div className="space-y-6">
        {back}
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-9 w-full max-w-xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (q.error || !site) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <EmptyState
            icon={<Globe />}
            title={t("网站不存在")}
            description={t("该网站可能已被删除，或你没有访问权限。")}
            action={
              <Button asChild variant="outline">
                <Link to="/sites">{t("返回网站列表")}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title={t("网站信息加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
        )}
      </div>
    );
  }

  const domain = primaryDomain(site);
  const base = `/sites/${site.id}`;
  return (
    <div>
      <div className="flex flex-col gap-5 pb-5">
        {back}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl border bg-subtle text-muted-foreground shadow-xs sm:flex">
              <Globe className="size-5" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight">{domain}</h1>
                {site.domains.length > 1 ? (
                  <Hint label={<span className="grid gap-0.5 font-mono">{site.domains.slice(1).map((d) => <span key={d}>{d}</span>)}</span>}>
                    <Link to={`${base}/domains`} className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                      {t("+{{n}} 个域名", { n: site.domains.length - 1 })}
                    </Link>
                  </Hint>
                ) : null}
                <SiteStatusBadge status={site.status} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <span className="text-xs font-medium">CNAME</span>
                  <span className="truncate font-mono text-[12.5px] text-foreground">{site.cname}</span>
                  <CopyButton value={site.cname} successText={t("已复制")} />
                </span>
                <span className="hidden text-border-strong sm:inline">|</span>
                <span className="tabular">{t("创建于 {{date}}", { date: formatDate(site.createdAt, currentLocale()) })}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {site.status === "active" ? (
              <Button variant="outline" asChild>
                <a href={`https://${domain.replace(/^\*\./, "www.")}`} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  {t("访问")}
                </a>
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => actions.askToggle(site)} loading={actions.toggling === site.id}>
              {actions.toggling === site.id ? null : site.isOn ? <Ban /> : <Play />}
              {site.isOn ? t("停用") : t("启用")}
            </Button>
            <Button variant="destructive-outline" onClick={() => actions.askDelete(site)}>
              <Trash2 />
              {t("删除")}
            </Button>
          </div>
        </div>
        <StatusBanner site={site} />
      </div>

      <RouteTabs
        className="mb-6"
        items={[
          { to: base, label: t("概览"), end: true },
          { to: `${base}/domains`, label: t("域名与源站") },
          { to: `${base}/https`, label: "HTTPS" },
          { to: `${base}/cache`, label: t("缓存") },
          { to: `${base}/security`, label: t("安全") },
          { to: `${base}/logs`, label: t("日志") },
        ]}
      />
      <Outlet context={{ site } satisfies SiteContext} />
      {actions.dialog}
    </div>
  );
}

function StatusBanner({ site }: { site: Site }) {
  const { t } = useTranslation();
  const pending = site.dnsChecks.filter((c) => !c.ok);
  if (site.status === "pending_dns") {
    return (
      <Banner tone="warning" icon={<Clock3 />} title={t("等待 CNAME 解析生效")} action={<BannerLink to={`/sites/${site.id}/domains`}>{t("查看解析指引")}</BannerLink>}>
        {t("在 DNS 服务商处将域名 CNAME 到 {{cname}} 后，网站才会开始加速。", { cname: site.cname })}
        {pending.length > 0 && site.dnsChecks.length > 0 ? ` ${t("还有 {{n}} 个域名未生效。", { n: pending.length })}` : ""}
      </Banner>
    );
  }
  if (site.status === "error") {
    return (
      <Banner tone="danger" icon={<AlertTriangle />} title={t("网站状态异常")} action={<BannerLink to={`/sites/${site.id}/domains`}>{t("检查源站")}</BannerLink>}>
        {site.dnsChecks.find((c) => c.message)?.message ?? t("边缘节点无法连接源站，请检查源站地址、端口与防火墙设置。")}
      </Banner>
    );
  }
  if (site.status === "disabled") {
    return (
      <Banner tone="neutral" icon={<CirclePause />} title={t("网站已停用")}>
        {t("边缘节点当前不为该网站提供服务。配置均已保留，启用后立即恢复。")}
      </Banner>
    );
  }
  return null;
}

const BANNER_TONES = {
  warning: "border-warning/30 bg-warning-soft/60 [&_.banner-icon]:text-warning-foreground",
  danger: "border-destructive/30 bg-destructive-soft/60 [&_.banner-icon]:text-destructive-foreground",
  neutral: "bg-subtle [&_.banner-icon]:text-muted-foreground",
} as const;

export function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center ${BANNER_TONES[tone]}`}>
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="banner-icon mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 space-y-0.5">
          <div className="text-[13px] font-medium">{title}</div>
          {children ? <div className="text-[13px] leading-relaxed break-words text-muted-foreground">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0 pl-7 sm:pl-0">{action}</div> : null}
    </div>
  );
}

function BannerLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={to}>
        {children}
        <ArrowRight />
      </Link>
    </Button>
  );
}
