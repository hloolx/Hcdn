import * as React from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  Award,
  Gauge,
  Globe,
  Info,
  MousePointerClick,
  OctagonAlert,
  Server,
  Table2,
  TriangleAlert,
  Users,
  BellOff,
} from "lucide-react";
import type { AdminAlert, AdminDashboard, NodeSummary, TimeRange } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { StatCard } from "@hcdn/ui/blocks/stat-card";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { StatusBadge, StatusDot } from "@hcdn/ui/blocks/status";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { ChartCard, ChartLegend, ChartTable, type SeriesDef } from "@hcdn/ui/charts/chart-kit";
import { TimeSeriesChart } from "@hcdn/ui/charts/time-series";
import { BarList } from "@hcdn/ui/charts/bar-list";
import { GeoMap, type GeoMarker } from "@hcdn/ui/charts/geo-map";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBits, formatBytes, formatCount, formatNumber, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { cityOf } from "@/lib/net";
import { delta, RANGE_OPTIONS, splitUnit, timeLabel, tooltipTimeLabel } from "@/lib/stats";
import { NodeStatusDot, nodeState } from "@/components/node-status";
import { UsageMeter } from "@/components/usage-meter";
import { useAllNodes } from "@/layouts/admin-layout";

export function DashboardPage() {
  const { t } = useTranslation();
  const [range, setRange] = React.useState<TimeRange>("24h");
  const q = useQuery({ queryKey: ["dashboard", range], queryFn: () => api.dashboard(range), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const data = q.data;
  const loading = q.isPending;
  const locale = currentLocale();

  if (q.error && !data) {
    return (
      <div>
        <PageHeader title={t("仪表盘")} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("仪表盘数据加载失败")} />
      </div>
    );
  }

  const bytes = splitUnit(formatBytes(data?.totals.bytes ?? 0));
  const peak = splitUnit(formatBits(data?.totals.peakBandwidthBps ?? 0));
  const nodes = data?.nodes;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("仪表盘")}
        description={t("全网流量、节点健康与告警概况")}
        actions={<Segmented value={range} onChange={setRange} options={RANGE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />}
      />

      <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4 transition-opacity", q.isPlaceholderData && "opacity-70")}>
        <StatCard
          label={t("全网流量")}
          icon={<Activity />}
          loading={loading}
          value={bytes.value}
          unit={bytes.unit}
          delta={delta(data?.totals.bytes ?? 0, data?.previous?.bytes)}
          hint={data?.previous ? t("较上一周期") : undefined}
          spark={data?.series.map((p) => p.bytes)}
        />
        <StatCard
          label={t("请求数")}
          icon={<MousePointerClick />}
          loading={loading}
          value={formatCount(data?.totals.requests ?? 0, locale)}
          delta={delta(data?.totals.requests ?? 0, data?.previous?.requests)}
          hint={data?.previous ? t("较上一周期") : undefined}
          spark={data?.series.map((p) => p.requests)}
          sparkColor="var(--chart-2)"
        />
        <StatCard
          label={t("峰值带宽")}
          icon={<Gauge />}
          loading={loading}
          value={peak.value}
          unit={peak.unit}
          delta={delta(data?.totals.peakBandwidthBps ?? 0, data?.previous?.peakBandwidthBps)}
          hint={data?.previous ? t("较上一周期") : undefined}
          spark={data?.series.map((p) => p.bandwidthBps)}
          sparkColor="var(--chart-3)"
        />
        <StatCard
          label={t("在线节点")}
          icon={<Server />}
          loading={loading}
          value={nodes ? String(nodes.online) : "—"}
          unit={nodes ? `/ ${nodes.total}` : undefined}
          hint={
            nodes ? (
              nodes.total === 0 ? (
                <span>{t("尚未添加节点")}</span>
              ) : nodes.offline > 0 ? (
                <StatusBadge tone="danger">{t("{{n}} 个离线", { n: nodes.offline })}</StatusBadge>
              ) : (
                <StatusBadge tone="success">{t("全部在线")}</StatusBadge>
              )
            ) : null
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <TrafficCard data={data} loading={loading} />
        <AlertsCard alerts={data?.alerts} loading={loading} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <NodeMapCard className="xl:col-span-3" />
        <QuickStatsCard data={data} loading={loading} className="xl:col-span-2" />
      </div>

      <NodeHealthCard nodes={data?.nodeHealth} loading={loading} />
    </div>
  );
}

function TrafficCard({ data, loading }: { data: AdminDashboard | undefined; loading: boolean }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [showTable, setShowTable] = React.useState(false);
  const series: SeriesDef[] = [
    { key: "bytes", label: t("总流量") },
    { key: "cachedBytes", label: t("缓存命中流量") },
  ];
  const step = data?.step ?? 3600;
  const empty = !loading && (data?.series.length ?? 0) === 0;
  return (
    <ChartCard
      className="xl:col-span-2"
      title={t("全网流量趋势")}
      description={t("所有租户经由边缘节点的出口流量，及其中由缓存直接响应的部分")}
      legend={empty ? undefined : <ChartLegend series={series} />}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("数据表")}
          title={t("数据表")}
          onClick={() => setShowTable((v) => !v)}
          className={showTable ? "bg-accent text-foreground" : "text-muted-foreground"}
        >
          <Table2 />
        </Button>
      }
    >
      {loading ? (
        <Skeleton className="mx-3 h-[260px]" />
      ) : empty ? (
        <EmptyState compact className="h-[260px]" icon={<Activity />} title={t("暂无流量数据")} description={t("节点上线并接入网站后，这里会显示全网流量。")} />
      ) : showTable ? (
        <div className="px-3">
          <ChartTable
            columns={[
              { key: "t", label: t("时间") },
              { key: "bytes", label: t("总流量"), align: "right" },
              { key: "cachedBytes", label: t("缓存命中流量"), align: "right" },
              { key: "bw", label: t("平均带宽"), align: "right" },
              { key: "requests", label: t("请求数"), align: "right" },
            ]}
            rows={(data?.series ?? []).map((p) => ({
              t: tooltipTimeLabel(step, locale)(p.t),
              bytes: formatBytes(p.bytes),
              cachedBytes: formatBytes(p.cachedBytes),
              bw: formatBits(p.bandwidthBps),
              requests: formatNumber(p.requests, locale),
            }))}
          />
        </div>
      ) : (
        <TimeSeriesChart
          data={(data?.series ?? []) as unknown as Record<string, number>[]}
          series={series}
          formatValue={(v) => formatBytes(v)}
          unit="bytes"
          formatTime={timeLabel(step, locale)}
          formatTooltipTime={tooltipTimeLabel(step, locale)}
        />
      )}
    </ChartCard>
  );
}

const ALERT_META: Record<AdminAlert["level"], { icon: typeof Info; className: string; label: string }> = {
  critical: { icon: OctagonAlert, className: "bg-destructive-soft text-destructive-foreground", label: "严重" },
  warning: { icon: TriangleAlert, className: "bg-warning-soft text-warning-foreground", label: "警告" },
  info: { icon: Info, className: "bg-info-soft text-info-foreground", label: "提示" },
};

function AlertsCard({ alerts, loading }: { alerts: AdminAlert[] | undefined; loading: boolean }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const critical = (alerts ?? []).filter((a) => a.level === "critical").length;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("告警")}
          {critical > 0 ? <StatusBadge tone="danger">{t("{{n}} 条严重", { n: critical })}</StatusBadge> : null}
        </CardTitle>
        <CardDescription>{t("需要运维关注的事件")}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/audit-logs">
              {t("审计日志")}
              <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !alerts || alerts.length === 0 ? (
          <EmptyState compact icon={<BellOff />} title={t("一切正常")} description={t("当前没有需要处理的告警。")} />
        ) : (
          <ol className="relative space-y-1">
            {alerts.map((a) => {
              const m = ALERT_META[a.level];
              return (
                <li key={a.id} className="flex gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-subtle">
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", m.className)} title={t(m.label)}>
                    <m.icon className="size-3.5" />
                    <span className="sr-only">{t(m.label)}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{t(a.title)}</span>
                      <time className="shrink-0 text-[11.5px] text-muted-foreground tabular">{formatRelative(a.time, locale)}</time>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.message}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

interface RegionGroup {
  key: string;
  label: string;
  lon: number;
  lat: number;
  online: number;
  offline: number;
  total: number;
  bandwidth: number;
}

function groupByCity(nodes: NodeSummary[], en: boolean): { groups: RegionGroup[]; unplaced: number } {
  const map = new Map<string, RegionGroup>();
  let unplaced = 0;
  for (const n of nodes) {
    const c = cityOf(n.region);
    if (!c) {
      unplaced++;
      continue;
    }
    const g = map.get(c.label) ?? { key: c.label, label: en ? c.labelEn : c.label, lon: c.lon, lat: c.lat, online: 0, offline: 0, total: 0, bandwidth: 0 };
    const s = nodeState(n);
    g.total++;
    if (s === "online") g.online++;
    if (s === "offline") g.offline++;
    g.bandwidth += n.bandwidthBps ?? 0;
    map.set(c.label, g);
  }
  return { groups: [...map.values()].sort((a, b) => b.total - a.total), unplaced };
}

function NodeMapCard({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const q = useAllNodes();
  const { groups, unplaced } = groupByCity(q.data?.items ?? [], i18n.language === "en");
  const markers: GeoMarker[] = groups.map((g) => ({
    id: g.key,
    label: `${g.label} ${g.online}/${g.total}`,
    lon: g.lon,
    lat: g.lat,
    // Any unreachable node turns the location red so it is never missed.
    status: g.offline > 0 ? "offline" : g.online > 0 ? "online" : "planned",
  }));
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{t("节点分布")}</CardTitle>
        <CardDescription>{t("按地区汇总的边缘节点与实时带宽")}</CardDescription>
        <CardAction className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <StatusDot tone="success" />
            {t("在线")}
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot tone="danger" />
            {t("有离线节点")}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 pt-2">
        {q.isPending ? (
          <>
            <Skeleton className="h-[270px]" />
            <div className="grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          </>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("节点数据加载失败")} />
        ) : groups.length === 0 && unplaced === 0 ? (
          <EmptyState
            icon={<Server />}
            title={t("还没有节点")}
            description={t("添加第一个边缘节点后，它会出现在地图上。")}
            action={
              <Button asChild size="sm">
                <Link to="/nodes?add=1">{t("添加节点")}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="min-w-0 overflow-hidden rounded-lg border bg-subtle/50 px-8 py-1">
              <GeoMap markers={markers} focus="apac" height={260} />
            </div>
            <ul className="grid gap-2 sm:grid-cols-3">
              {groups.map((g) => (
                <li key={g.key}>
                  <Link
                    to={`/nodes?keyword=${encodeURIComponent(g.key)}`}
                    className="flex items-center gap-3 rounded-lg border bg-subtle px-3 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <StatusDot tone={g.offline > 0 ? "danger" : "success"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{g.label}</div>
                      <div className="text-xs text-muted-foreground tabular">
                        {t("{{online}}/{{total}} 在线", { online: g.online, total: g.total })}
                        {g.offline > 0 ? <span className="text-destructive-foreground"> · {t("{{n}} 个离线", { n: g.offline })}</span> : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-medium tabular">{formatBits(g.bandwidth)}</div>
                      <div className="text-[11px] text-muted-foreground">{t("出口带宽")}</div>
                    </div>
                  </Link>
                </li>
              ))}
              {unplaced > 0 ? <li className="px-1 text-xs text-muted-foreground sm:col-span-3">{t("另有 {{n}} 个节点未设置地区", { n: unplaced })}</li> : null}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QuickStatsCard({ data, loading, className }: { data: AdminDashboard | undefined; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{t("租户概况")}</CardTitle>
        <CardDescription>{t("用户、网站与证书")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-2">
        <div className="grid grid-cols-3 gap-3">
          <QuickStat
            to="/users"
            icon={<Users className="size-4" />}
            label={t("用户")}
            value={loading ? null : formatNumber(data?.users.total ?? 0, locale)}
            extra={data && data.users.newThisWeek > 0 ? <span className="text-success-foreground">{t("本周 +{{n}}", { n: data.users.newThisWeek })}</span> : null}
          />
          <QuickStat to="/sites" icon={<Globe className="size-4" />} label={t("网站")} value={loading ? null : formatNumber(data?.sitesCount ?? 0, locale)} />
          <QuickStat
            to="/certs"
            icon={<Award className={cn("size-4", (data?.certsExpiringSoon ?? 0) > 0 && "text-warning")} />}
            label={t("即将过期证书")}
            value={loading ? null : String(data?.certsExpiringSoon ?? 0)}
            extra={data && data.certsExpiringSoon > 0 ? <span className="text-warning-foreground">{t("14 天内")}</span> : null}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium">{t("流量最高的网站")}</span>
            <Button variant="ghost" size="sm" className="-mr-2 h-7 text-muted-foreground" asChild>
              <Link to="/sites">
                {t("全部")}
                <ArrowRight />
              </Link>
            </Button>
          </div>
          {loading ? (
            <div className="space-y-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <BarList
              items={(data?.topSites ?? []).slice(0, 5).map((s) => ({ key: String(s.siteId), label: s.domain, value: s.bytes }))}
              formatValue={(v) => formatBytes(v)}
              emptyText={t("暂无数据")}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function QuickStat({ to, icon, label, value, extra }: { to: string; icon: React.ReactNode; label: string; value: string | null; extra?: React.ReactNode }) {
  return (
    <Link to={to} className="group rounded-lg border bg-subtle p-3 transition-colors hover:border-border-strong">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {value == null ? <Skeleton className="mt-2 h-6 w-12" /> : <div className="mt-1 text-xl font-semibold tracking-tight tabular">{value}</div>}
      <div className="mt-0.5 min-h-4 text-[11.5px]">{extra}</div>
    </Link>
  );
}

function NodeHealthCard({ nodes, loading }: { nodes: NodeSummary[] | undefined; loading: boolean }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle>{t("节点健康")}</CardTitle>
        <CardDescription>{t("按出口带宽排序，离线节点排在最后")}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/nodes">
              {t("全部节点")}
              <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      {loading ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : !nodes || nodes.length === 0 ? (
        <EmptyState compact icon={<Server />} title={t("还没有节点")} description={t("添加节点后，这里会显示 CPU、内存与带宽。")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("节点")}</TableHead>
              <TableHead>{t("集群")}</TableHead>
              <TableHead>{t("地区")}</TableHead>
              <TableHead>CPU</TableHead>
              <TableHead>{t("内存")}</TableHead>
              <TableHead className="text-right">{t("带宽")}</TableHead>
              <TableHead className="text-right">{t("连接数")}</TableHead>
              <TableHead className="text-right">{t("最后心跳")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.slice(0, 8).map((n) => (
              <TableRow key={n.id}>
                <TableCell>
                  <Link to={`/nodes/${n.id}`} className="group flex items-center gap-2.5">
                    <NodeStatusDot node={n} />
                    <span className="font-medium group-hover:underline">{n.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{n.ips[0]}</span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{n.clusterName}</TableCell>
                <TableCell className="text-muted-foreground">{n.region || "—"}</TableCell>
                <TableCell>
                  <UsageMeter value={n.cpu} />
                </TableCell>
                <TableCell>
                  <UsageMeter value={n.memory} />
                </TableCell>
                <TableCell className="text-right tabular">{formatBits(n.bandwidthBps)}</TableCell>
                <TableCell className="text-right tabular">{formatNumber(n.connections, locale)}</TableCell>
                <TableCell className={cn("text-right text-xs tabular", nodeState(n) === "offline" ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>
                  {formatRelative(n.updatedAt, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
