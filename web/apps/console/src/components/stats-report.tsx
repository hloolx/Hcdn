import * as React from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, BarChart3, Database, Gauge, Globe, ShieldAlert, Table2 } from "lucide-react";
import type { StatsReport } from "@hcdn/api/types";
import { StatCard } from "@hcdn/ui/blocks/stat-card";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { ChartCard, ChartLegend, ChartTable, type SeriesDef } from "@hcdn/ui/charts/chart-kit";
import { TimeSeriesChart } from "@hcdn/ui/charts/time-series";
import { BarList, Meter } from "@hcdn/ui/charts/bar-list";
import { GeoMap } from "@hcdn/ui/charts/geo-map";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBits, formatBytes, formatCount, formatNumber, formatPercent } from "@hcdn/ui/lib/format";
import { currentLocale } from "@/lib/i18n";
import { delta, hitRatio, STATUS_COLORS, timeLabel, tooltipTimeLabel } from "@/lib/stats";

/**
 * Building blocks for traffic reports (the analytics page and the site
 * overview tab). Series colors follow the entity everywhere:
 * total → chart-1, served from cache → chart-2, fetched from origin → chart-3.
 */
export const ENTITY_COLORS = { total: "var(--chart-1)", cached: "var(--chart-2)", origin: "var(--chart-3)" } as const;

const STATUS_LABELS: Record<string, string> = { "2xx": "成功", "3xx": "重定向", "4xx": "客户端错误", "5xx": "服务端错误" };

/** Axis labels must not wrap ("429 MB" → one line). */
const nb = (s: string) => s.replace(/ /g, " ");

function split(v: string) {
  const [value, unit] = v.split(" ");
  return { value: value ?? v, unit };
}

function isEmpty(r: StatsReport | undefined) {
  return !!r && r.totals.requests === 0;
}

export function StatsKpis({ report, loading }: { report?: StatsReport; loading: boolean }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const tot = report?.totals;
  const prev = report?.previous;
  const ratio = hitRatio(tot);
  const prevRatio = hitRatio(prev);
  const bytes = split(formatBytes(tot?.bytes ?? 0));
  const bw = split(formatBits(tot?.peakBandwidthBps ?? 0));
  const attackShare = tot && tot.requests ? tot.attackRequests / tot.requests : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
      <StatCard
        label={t("总流量")}
        icon={<Activity />}
        loading={loading}
        value={bytes.value}
        unit={bytes.unit}
        delta={delta(tot?.bytes ?? 0, prev?.bytes)}
        hint={prev ? t("较上一周期") : undefined}
      />
      <StatCard
        label={t("请求数")}
        icon={<Globe />}
        loading={loading}
        value={formatCount(tot?.requests ?? 0, locale)}
        delta={delta(tot?.requests ?? 0, prev?.requests)}
        hint={prev ? t("较上一周期") : undefined}
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
        value={bw.value}
        unit={bw.unit}
        delta={delta(tot?.peakBandwidthBps ?? 0, prev?.peakBandwidthBps)}
        hint={prev ? t("较上一周期") : undefined}
      />
      <StatCard
        className="col-span-2 xl:col-span-1"
        label={t("拦截的攻击")}
        icon={<ShieldAlert />}
        loading={loading}
        value={formatCount(tot?.attackRequests ?? 0, locale)}
        delta={delta(tot?.attackRequests ?? 0, prev?.attackRequests)}
        invertDelta
        hint={attackShare != null ? t("占请求 {{p}}", { p: formatPercent(attackShare, 2) }) : undefined}
      />
    </div>
  );
}

function ChartEmpty({ height = 260 }: { height?: number }) {
  const { t } = useTranslation();
  return (
    <div className="mx-3 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-subtle/50 text-center" style={{ height }}>
      <BarChart3 className="size-5 text-muted-foreground/70" />
      <div className="text-[13px] font-medium">{t("暂无流量数据")}</div>
      <div className="max-w-xs text-xs text-muted-foreground">{t("所选时间范围内没有请求。CNAME 生效后，数据通常在 5 分钟内出现。")}</div>
    </div>
  );
}

function TableToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="icon-sm" aria-label={t("数据表")} aria-pressed={on} title={t("数据表")} onClick={onToggle} className={on ? "bg-accent" : ""}>
      <Table2 />
    </Button>
  );
}

/** Traffic (bytes per bucket, total vs cached) or average bandwidth — one unit per chart. */
export function TrafficChartCard({ report, loading, className }: { report?: StatsReport; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [metric, setMetric] = React.useState<"bytes" | "bandwidth">("bytes");
  const [table, setTable] = React.useState(false);
  const step = report?.step ?? 3600;
  const series: SeriesDef[] =
    metric === "bytes"
      ? [
          { key: "bytes", label: t("总流量"), color: ENTITY_COLORS.total },
          { key: "cachedBytes", label: t("缓存命中流量"), color: ENTITY_COLORS.cached },
        ]
      : [{ key: "bandwidthBps", label: t("平均带宽"), color: ENTITY_COLORS.total }];
  const fmt = metric === "bytes" ? (v: number) => formatBytes(v) : (v: number) => formatBits(v);
  const fmtAxis = metric === "bytes" ? (v: number) => nb(formatBytes(v, 1).replace(".0 ", " ")) : (v: number) => nb(formatBits(v, 1).replace(".0 ", " "));
  return (
    <ChartCard
      className={className}
      title={metric === "bytes" ? t("流量趋势") : t("带宽趋势")}
      description={metric === "bytes" ? t("每个时间段的总流量，以及其中由缓存直接响应的部分") : t("每个时间段的平均出口带宽")}
      legend={isEmpty(report) ? null : <ChartLegend series={series} />}
      actions={
        <>
          <Segmented
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "bytes", label: t("流量") },
              { value: "bandwidth", label: t("带宽") },
            ]}
          />
          <TableToggle on={table} onToggle={() => setTable((v) => !v)} />
        </>
      }
    >
      {loading ? (
        <Skeleton className="mx-3 h-[260px]" />
      ) : isEmpty(report) ? (
        <ChartEmpty />
      ) : table ? (
        <div className="px-3">
          <ChartTable
            columns={[
              { key: "t", label: t("时间") },
              { key: "bytes", label: t("总流量"), align: "right" },
              { key: "cachedBytes", label: t("缓存命中流量"), align: "right" },
              { key: "bw", label: t("平均带宽"), align: "right" },
            ]}
            rows={(report?.series ?? []).map((p) => ({
              t: tooltipTimeLabel(step, locale)(p.t),
              bytes: formatBytes(p.bytes),
              cachedBytes: formatBytes(p.cachedBytes),
              bw: formatBits(p.bandwidthBps),
            }))}
          />
        </div>
      ) : (
        <TimeSeriesChart
          data={(report?.series ?? []) as unknown as Record<string, number>[]}
          series={series}
          formatValue={fmt}
          formatAxisValue={fmtAxis}
          formatTime={timeLabel(step, locale)}
          formatTooltipTime={tooltipTimeLabel(step, locale)}
        />
      )}
    </ChartCard>
  );
}

/** Requests per bucket, stacked: served from cache + fetched from origin. */
export function RequestsChartCard({ report, loading, className, height = 240 }: { report?: StatsReport; loading: boolean; className?: string; height?: number }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [table, setTable] = React.useState(false);
  const step = report?.step ?? 3600;
  const series: SeriesDef[] = [
    { key: "cachedRequests", label: t("缓存命中"), color: ENTITY_COLORS.cached },
    { key: "originRequests", label: t("回源"), color: ENTITY_COLORS.origin },
  ];
  const data = React.useMemo(
    () => (report?.series ?? []).map((p) => ({ t: p.t, cachedRequests: p.cachedRequests, originRequests: Math.max(0, p.requests - p.cachedRequests) })),
    [report],
  );
  return (
    <ChartCard
      className={className}
      title={t("请求数")}
      description={t("每个时间段的请求，按是否命中缓存堆叠")}
      legend={isEmpty(report) ? null : <ChartLegend series={series} />}
      actions={<TableToggle on={table} onToggle={() => setTable((v) => !v)} />}
    >
      {loading ? (
        <Skeleton className="mx-3" style={{ height }} />
      ) : isEmpty(report) ? (
        <ChartEmpty height={height} />
      ) : table ? (
        <div className="px-3">
          <ChartTable
            columns={[
              { key: "t", label: t("时间") },
              { key: "all", label: t("请求数"), align: "right" },
              { key: "cached", label: t("缓存命中"), align: "right" },
              { key: "origin", label: t("回源"), align: "right" },
            ]}
            rows={data.map((p) => ({
              t: tooltipTimeLabel(step, locale)(p.t),
              all: formatNumber(p.cachedRequests + p.originRequests, locale),
              cached: formatNumber(p.cachedRequests, locale),
              origin: formatNumber(p.originRequests, locale),
            }))}
          />
        </div>
      ) : (
        <TimeSeriesChart
          kind="bar"
          stacked
          height={height}
          data={data}
          series={series}
          formatValue={(v) => formatNumber(v, locale)}
          formatAxisValue={(v) => formatCount(v, locale)}
          formatTime={timeLabel(step, locale)}
          formatTooltipTime={tooltipTimeLabel(step, locale)}
        />
      )}
    </ChartCard>
  );
}

/** Cache hit ratio per bucket (by requests). */
export function HitRatioChartCard({ report, loading, className, height = 240 }: { report?: StatsReport; loading: boolean; className?: string; height?: number }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const step = report?.step ?? 3600;
  const data = React.useMemo(() => (report?.series ?? []).map((p) => ({ t: p.t, ratio: p.requests ? (p.cachedRequests / p.requests) * 100 : 0 })), [report]);
  const ratio = hitRatio(report?.totals);
  return (
    <ChartCard
      className={className}
      title={t("缓存命中率")}
      description={t("命中缓存的请求占比，越高回源越少")}
      figure={
        loading ? null : (
          <span className="text-xl font-semibold tracking-tight tabular">{ratio == null ? "—" : formatPercent(ratio)}</span>
        )
      }
    >
      {loading ? (
        <Skeleton className="mx-3" style={{ height }} />
      ) : isEmpty(report) ? (
        <ChartEmpty height={height} />
      ) : (
        <TimeSeriesChart
          kind="line"
          height={height}
          data={data}
          series={[{ key: "ratio", label: t("缓存命中率"), color: ENTITY_COLORS.cached }]}
          formatValue={(v) => `${v.toFixed(1)}%`}
          formatAxisValue={(v) => `${Math.round(v)}%`}
          formatTime={timeLabel(step, locale)}
          formatTooltipTime={tooltipTimeLabel(step, locale)}
        />
      )}
    </ChartCard>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

export function StatusCodesCard({ report, loading, className, footer = "ratio" }: { report?: StatsReport; loading: boolean; className?: string; footer?: "ratio" | "errors" }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const ratio = hitRatio(report?.totals);
  const total = (report?.statusCodes ?? []).reduce((a, s) => a + s.count, 0);
  const errors = (report?.statusCodes ?? []).filter((s) => s.code === "4xx" || s.code === "5xx").reduce((a, s) => a + s.count, 0);
  const errorRate = total ? errors / total : null;
  const serverErrors = report?.statusCodes.find((s) => s.code === "5xx")?.count ?? 0;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("状态码分布")}</CardTitle>
        <CardDescription>{t("全部请求的 HTTP 响应状态")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <ListSkeleton rows={4} />
        ) : (
          <BarList
            items={(report?.statusCodes ?? []).map((s) => ({
              key: s.code,
              label: (
                <>
                  <span className="font-medium">{s.code}</span>
                  <span className="ml-1.5 text-muted-foreground">{t(STATUS_LABELS[s.code] ?? "")}</span>
                </>
              ),
              value: s.count,
              color: STATUS_COLORS[s.code],
              hint: total ? formatPercent(s.count / total) : undefined,
            }))}
            formatValue={(v) => formatCount(v, locale)}
            emptyText={t("暂无数据")}
          />
        )}
        {footer === "errors" ? (
          <div className="rounded-lg border bg-subtle p-3">
            <Meter
              value={errorRate ?? 0}
              tone={errorRate != null && errorRate > 0.1 ? "danger" : "warning"}
              label={
                <>
                  <span>{t("错误率（4xx + 5xx）")}</span>
                  <span className="font-medium text-foreground tabular">{errorRate == null ? "—" : formatPercent(errorRate, 2)}</span>
                </>
              }
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {total && serverErrors / total > 0.01 ? t("5xx 偏高，通常意味着源站响应慢或不可用，请检查源站。") : t("4xx 多为访客请求了不存在的页面或被安全规则拦截。")}
            </p>
          </div>
        ) : (
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
              {ratio != null && ratio < 0.5 ? t("命中率偏低，可为静态资源配置更长的缓存时间。") : t("命中的请求直接由边缘节点响应，不再回源。")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RegionsCard({ report, loading, className }: { report?: StatsReport; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [table, setTable] = React.useState(false);
  const regions = report?.regions ?? [];
  const total = regions.reduce((a, r) => a + r.bytes, 0);
  return (
    <Card className={className}>
      <CardHeader className="grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <CardTitle>{t("访客地区分布")}</CardTitle>
          <CardDescription>{t("按流量统计的访问来源")}</CardDescription>
        </div>
        <TableToggle on={table} onToggle={() => setTable((v) => !v)} />
      </CardHeader>
      <CardContent className={cn("pt-2", !table && "grid gap-6 lg:grid-cols-[1.4fr_1fr]")}>
        {table ? (
          <ChartTable
            columns={[
              { key: "name", label: t("地区") },
              { key: "bytes", label: t("流量"), align: "right" },
              { key: "share", label: t("占比"), align: "right" },
              { key: "requests", label: t("请求数"), align: "right" },
            ]}
            rows={regions.map((r) => ({
              name: r.name || t("未知"),
              bytes: formatBytes(r.bytes),
              share: total ? formatPercent(r.bytes / total) : "—",
              requests: formatNumber(r.requests, locale),
            }))}
          />
        ) : (
          <>
            {loading ? <Skeleton className="h-[240px]" /> : <GeoMap data={regions.map((r) => ({ code: r.code, name: r.name, value: r.bytes }))} formatValue={(v) => formatBytes(v)} height={240} legendLabel={t("流量")} />}
            {loading ? (
              <ListSkeleton rows={6} />
            ) : (
              <BarList
                items={regions.slice(0, 7).map((r) => ({ key: r.code || r.name, label: r.name || t("未知"), value: r.bytes, hint: total ? formatPercent(r.bytes / total, 0) : undefined }))}
                formatValue={(v) => formatBytes(v)}
                emptyText={t("暂无数据")}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function TopSitesCard({ report, loading, className }: { report?: StatsReport; loading: boolean; className?: string }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("流量最高的网站")}</CardTitle>
        <CardDescription>{t("所选时间范围内，按流量排序")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <ListSkeleton rows={5} />
        ) : (
          <BarList
            items={(report?.topSites ?? []).map((s) => ({
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
      </CardContent>
    </Card>
  );
}
