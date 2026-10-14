import * as React from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronRight, Lock, LockOpen, Server, ShieldCheck, Zap } from "lucide-react";
import type { TimeRange } from "@hcdn/api/types";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { ErrorState } from "@hcdn/ui/blocks/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { api } from "@/lib/api";
import { RANGE_OPTIONS } from "@/lib/stats";
import { originLabel } from "@/lib/site";
import { RequestsChartCard, StatsKpis, StatusCodesCard, TrafficChartCard } from "@/components/stats-report";
import { useSite } from "./layout";

export function SiteOverviewTab() {
  const { t } = useTranslation();
  const site = useSite();
  const [range, setRange] = React.useState<TimeRange>("24h");
  const q = useQuery({ queryKey: ["stats", range, site.id], queryFn: () => api.stats(range, site.id), placeholderData: keepPreviousData });
  const loading = q.isPending;

  if (q.error && !q.data) {
    return <ErrorState title={t("统计数据加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{t("流量概况")}</h2>
        <Segmented value={range} onChange={setRange} options={RANGE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />
      </div>
      <StatsKpis report={q.data} loading={loading} />
      <div className="grid gap-4 xl:grid-cols-3">
        <TrafficChartCard className="xl:col-span-2" report={q.data} loading={loading} />
        <StatusCodesCard report={q.data} loading={loading} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <RequestsChartCard className="xl:col-span-2" report={q.data} loading={loading} />
        <ConfigSummary />
      </div>
    </div>
  );
}

function ConfigSummary() {
  const { t } = useTranslation();
  const site = useSite();
  const base = `/sites/${site.id}`;
  const rows = [
    {
      to: `${base}/domains`,
      icon: <Server />,
      label: t("源站"),
      value: site.origins.length > 1 ? t("{{first}} 等 {{n}} 个", { first: originLabel(site.origins[0]!), n: site.origins.length }) : site.origins[0] ? originLabel(site.origins[0]) : "—",
      mono: true,
    },
    {
      to: `${base}/https`,
      icon: site.https.enabled ? <Lock /> : <LockOpen />,
      label: "HTTPS",
      value: site.https.enabled ? [t("已启用"), site.https.forceRedirect ? t("强制跳转") : null, site.https.http2 ? "HTTP/2" : null, `TLS ${site.https.minTlsVersion}+`].filter(Boolean).join(" · ") : t("未启用"),
    },
    { to: `${base}/cache`, icon: <Zap />, label: t("缓存"), value: t("查看缓存规则") },
    { to: `${base}/security`, icon: <ShieldCheck />, label: t("安全"), value: t("WAF、IP 名单与频率限制") },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("配置摘要")}</CardTitle>
        <CardDescription>{t("当前生效的主要配置")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-3">
        <ul className="-mx-2 grid gap-0.5">
          {rows.map((r) => (
            <li key={r.to}>
              <Link to={r.to} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-subtle text-muted-foreground [&_svg]:size-4">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{r.label}</span>
                  <span className={`block truncate text-xs text-muted-foreground ${r.mono ? "font-mono" : ""}`}>{r.value}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
