import * as React from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Activity, ArrowRight, Database, Gauge, Globe, Plus, ShieldAlert, ShieldCheck, Table2 } from "lucide-react";
import type { TimeRange } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { StatCard } from "@hcdn/ui/blocks/stat-card";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { ErrorState, EmptyState } from "@hcdn/ui/blocks/states";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@hcdn/ui/components/card";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { ChartCard, ChartLegend, ChartTable, type SeriesDef } from "@hcdn/ui/charts/chart-kit";
import { TimeSeriesChart } from "@hcdn/ui/charts/time-series";
import { BarList, Meter } from "@hcdn/ui/charts/bar-list";
import { GeoMap } from "@hcdn/ui/charts/geo-map";
import { formatBits, formatBytes, formatCount, formatPercent } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { currentLocale } from "@/lib/i18n";
import { delta, hitRatio, RANGE_OPTIONS, STATUS_COLORS, timeLabel, tooltipTimeLabel } from "@/lib/stats";

export function OverviewPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [range, setRange] = React.useState<TimeRange>("24h");
  const [showTable, setShowTable] = React.useState(false);
  const q = useQuery({ queryKey: ["overview", range], queryFn: () => api.overview(range), placeholderData: keepPreviousData });
  const locale = currentLocale();
  const data = q.data;
  const loading = q.isPending;

  const trafficSeries: SeriesDef[] = [
    { key: "bytes", label: t("总流量") },
    { key: "cachedBytes", label: t("缓存命中流量") },
  ];
  const ratio = hitRatio(data?.totals);
  const prevRatio = hitRatio(data?.previous);

  if (q.error && !data) {
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("概览数据加载失败")} />;
  }

  const hello = me.data ? t("你好，{{name}}", { name: me.data.fullname || me.data.username }) : t("概览");

  return (
    <div className="space-y-6">
      <PageHeader
        title={hello}
        description={t("全部网站的流量、请求与安全事件概况")}
        actions={
          <>
            <Segmented value={range} onChange={setRange} options={RANGE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />
            <Button asChild>
              <Link to="/sites/new">
                <Plus />
                {t("添加网站")}
              </Link>
            </Button>
          </>
        }
      />

      {data && data.sites.total === 0 ? <GettingStarted /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("总流量")}
          icon={<Activity />}
          loading={loading}
          value={formatBytes(data?.totals.bytes ?? 0).split(" ")[0]}
          unit={formatBytes(data?.totals.bytes ?? 0).split(" ")[1]}
          delta={delta(data?.totals.bytes ?? 0, data?.previous?.bytes)}
          hint={t("较上一周期")}
          spark={data?.series.map((p) => p.bytes)}
        />
        <StatCard
          label={t("请求数")}
          icon={<Globe />}
          loading={loading}
          value={formatCount(data?.totals.requests ?? 0, locale)}
          delta={delta(data?.totals.requests ?? 0, data?.previous?.requests)}
          hint={t("较上一周期")}
          spark={data?.series.map((p) => p.requests)}
          sparkColor="var(--chart-2)"
        />
        <StatCard
          label={t("缓存命中率")}
          icon={<Database />}
          loading={loading}
          value={ratio == null ? "—" : formatPercent(ratio).replace("%", "")}
          unit={ratio == null ? undefined : "%"}
          delta={ratio != null && prevRatio != null ? ratio - prevRatio : null}
          hint={t("按请求数计算")}
        />
        <StatCard
          label={t("峰值带宽")}
          icon={<Gauge />}
          loading={loading}
          value={formatBits(data?.totals.peakBandwidthBps ?? 0).split(" ")[0]}
          unit={formatBits(data?.totals.peakBandwidthBps ?? 0).split(" ")[1]}
          delta={delta(data?.totals.peakBandwidthBps ?? 0, data?.previous?.peakBandwidthBps)}
          hint={t("较上一周期")}
          spark={data?.series.map((p) => p.bandwidthBps)}
          sparkColor="var(--chart-3)"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title={t("流量趋势")}
          description={t("总流量与其中由缓存直接响应的部分")}
          legend={<ChartLegend series={trafficSeries} />}
          actions={
            <Button variant="ghost" size="icon-sm" aria-label={t("数据表")} onClick={() => setShowTable((v) => !v)} className={showTable ? "bg-accent" : ""}>
              <Table2 />
            </Button>
          }
        >
          {loading ? (
            <Skeleton className="mx-3 h-[260px]" />
          ) : showTable ? (
            <div className="px-3">
              <ChartTable
                columns={[
                  { key: "t", label: t("时间") },
                  { key: "bytes", label: t("总流量"), align: "right" },
                  { key: "cachedBytes", label: t("缓存命中流量"), align: "right" },
                  { key: "requests", label: t("请求数"), align: "right" },
                ]}
                rows={(data?.series ?? []).map((p) => ({
                  t: tooltipTimeLabel(data?.step ?? 3600, locale)(p.t),
                  bytes: formatBytes(p.bytes),
                  cachedBytes: formatBytes(p.cachedBytes),
                  requests: formatCount(p.requests, locale),
                }))}
              />
            </div>
          ) : (
            <TimeSeriesChart
              data={(data?.series ?? []) as unknown as Record<string, number>[]}
              series={trafficSeries}
              formatValue={(v) => formatBytes(v)}
              unit="bytes"
              formatTime={timeLabel(data?.step ?? 3600, locale)}
              formatTooltipTime={tooltipTimeLabel(data?.step ?? 3600, locale)}
            />
          )}
        </ChartCard>

        <Card>
          <CardHeader>
            <CardTitle>{t("状态码分布")}</CardTitle>
            <CardDescription>{t("全部请求的 HTTP 响应状态")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : (
              <BarList
                items={(data?.statusCodes ?? []).map((s) => ({ key: s.code, label: s.code, value: s.count, color: STATUS_COLORS[s.code] }))}
                formatValue={(v) => formatCount(v, locale)}
                emptyText={t("暂无数据")}
              />
            )}
            <div className="rounded-lg border bg-subtle p-3">
              <Meter
                value={ratio ?? 0}
                tone={ratio != null && ratio < 0.5 ? "warning" : "primary"}
                label={
                  <>
                    <span>{t("缓存命中率")}</span>
                    <span className="font-medium text-foreground tabular">{ratio == null ? "—" : formatPercent(ratio)}</span>
                  </>
                }
              />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {ratio != null && ratio < 0.5
                  ? t("命中率偏低，可为静态资源配置更长的缓存时间。")
                  : t("命中的请求直接由边缘节点响应，不再回源。")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>{t("访客地区分布")}</CardTitle>
            <CardDescription>{t("按流量统计的访问来源")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 pt-2 lg:grid-cols-[1.4fr_1fr]">
            <GeoMap data={(data?.regions ?? []).map((r) => ({ code: r.code, name: r.name, value: r.bytes }))} formatValue={(v) => formatBytes(v)} height={240} legendLabel={t("流量")} />
            <BarList
              items={(data?.regions ?? []).slice(0, 6).map((r) => ({ key: r.code || r.name, label: r.name, value: r.bytes }))}
              formatValue={(v) => formatBytes(v)}
              emptyText={t("暂无数据")}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{t("流量最高的网站")}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/sites">
                  {t("全部网站")}
                  <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : (
              <BarList
                items={(data?.topSites ?? []).map((s) => ({
                  key: String(s.siteId),
                  label: (
                    <Link to={`/sites/${s.siteId}`} className="hover:underline">
                      {s.domain}
                    </Link>
                  ),
                  value: s.bytes,
                  hint: formatCount(s.requests, locale),
                }))}
                formatValue={(v) => formatBytes(v)}
                emptyText={t("暂无数据")}
              />
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <MiniStat
                icon={<Globe className="size-4" />}
                label={t("网站")}
                value={data ? `${data.sites.active}/${data.sites.total}` : "—"}
                extra={data && data.sites.pendingDns > 0 ? <StatusBadge tone="warning">{t("{{n}} 个待解析", { n: data.sites.pendingDns })}</StatusBadge> : null}
              />
              <MiniStat
                icon={data && data.certs.expiringSoon > 0 ? <ShieldAlert className="size-4 text-warning" /> : <ShieldCheck className="size-4" />}
                label={t("证书")}
                value={data ? String(data.certs.total) : "—"}
                extra={data && data.certs.expiringSoon > 0 ? <StatusBadge tone="warning">{t("{{n}} 个即将过期", { n: data.certs.expiringSoon })}</StatusBadge> : null}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, extra }: { icon: React.ReactNode; label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-subtle p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{value}</div>
      {extra ? <div className="mt-1.5">{extra}</div> : null}
    </div>
  );
}

function GettingStarted() {
  const { t } = useTranslation();
  const steps = [
    { title: t("添加网站"), desc: t("填写要加速的域名和源站地址") },
    { title: t("配置 CNAME"), desc: t("在 DNS 服务商处把域名解析到我们提供的 CNAME") },
    { title: t("开始加速"), desc: t("解析生效后流量自动经由边缘节点，可开启 HTTPS 与防护") },
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-xs">
      <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,var(--primary-soft),transparent_70%)]" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">{t("三步开始使用 Hcdn")}</h2>
          <p className="text-sm text-muted-foreground">{t("添加第一个网站，几分钟内即可让全球访客就近访问。")}</p>
        </div>
        <Button asChild size="lg">
          <Link to="/sites/new">
            <Plus />
            {t("添加第一个网站")}
          </Link>
        </Button>
      </div>
      <ol className="relative mt-6 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl border bg-background/70 p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
            <div>
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{s.desc}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t("页面不存在")}
      description={t("你访问的页面可能已被移动或删除。")}
      action={
        <Button asChild variant="outline">
          <Link to="/">{t("返回概览")}</Link>
        </Button>
      }
    />
  );
}
