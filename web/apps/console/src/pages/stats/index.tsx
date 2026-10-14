import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { TimeRange } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { ErrorState } from "@hcdn/ui/blocks/states";
import { Card } from "@hcdn/ui/components/card";
import { api } from "@/lib/api";
import { RANGE_OPTIONS } from "@/lib/stats";
import { SitePicker } from "@/components/site-picker";
import { HitRatioChartCard, RegionsCard, RequestsChartCard, StatsKpis, StatusCodesCard, TopSitesCard, TrafficChartCard } from "@/components/stats-report";

const RANGES = new Set(RANGE_OPTIONS.map((o) => o.value));

export function StatsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const rawRange = params.get("range") as TimeRange | null;
  const range: TimeRange = rawRange && RANGES.has(rawRange) ? rawRange : "24h";
  const siteId = Number(params.get("site")) || undefined;

  const set = (k: string, v: string | undefined) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true },
    );

  const q = useQuery({ queryKey: ["stats", range, siteId ?? null], queryFn: () => api.stats(range, siteId), placeholderData: keepPreviousData });
  const report = q.data;
  const loading = q.isPending;

  return (
    <div className="space-y-4">
      <PageHeader
        className="pb-2"
        title={t("统计分析")}
        description={t("流量、请求、缓存命中与访客分布。数据约有 1–5 分钟延迟。")}
        actions={
          <>
            {q.isFetching && !loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("正在更新")} /> : null}
            <SitePicker value={siteId} onChange={(id) => set("site", id ? String(id) : undefined)} className="w-full sm:w-56" />
            <Segmented value={range} onChange={(r) => set("range", r === "24h" ? undefined : r)} options={RANGE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} />
          </>
        }
      />

      {q.error && !report ? (
        <Card>
          <ErrorState title={t("统计数据加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
        </Card>
      ) : (
        <>
          <StatsKpis report={report} loading={loading} />
          <div className="grid gap-4 xl:grid-cols-3">
            <TrafficChartCard className="xl:col-span-2" report={report} loading={loading} />
            <StatusCodesCard report={report} loading={loading} footer="errors" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <RequestsChartCard report={report} loading={loading} />
            <HitRatioChartCard report={report} loading={loading} />
          </div>
          <div className="grid gap-4 xl:grid-cols-5">
            <RegionsCard className={siteId ? "xl:col-span-5" : "xl:col-span-3"} report={report} loading={loading} />
            {siteId ? null : <TopSitesCard className="xl:col-span-2" report={report} loading={loading} />}
          </div>
        </>
      )}
    </div>
  );
}
