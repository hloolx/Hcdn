import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CirclePause, CirclePlay, Table2, Trash2, TriangleAlert, Waypoints } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import type { NodeDetail } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { CopyButton } from "@hcdn/ui/blocks/status";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { toast } from "@hcdn/ui/components/toaster";
import { ChartCard, ChartTable } from "@hcdn/ui/charts/chart-kit";
import { TimeSeriesChart } from "@hcdn/ui/charts/time-series";
import { formatBits, formatDateTime, formatNumber, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { toastError } from "@/lib/hooks";
import { bitsAxis, timeLabel, tooltipTimeLabel } from "@/lib/stats";
import { NodeStatusBadge, nodeState } from "@/components/node-status";
import { UsageMeter } from "@/components/usage-meter";
import { NotFoundPage } from "@/pages/not-found";

export function NodeDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const nodeId = Number(id);
  const q = useQuery({ queryKey: ["nodes", "detail", nodeId], queryFn: () => api.node(nodeId), enabled: Number.isFinite(nodeId), refetchInterval: 60_000 });

  if (q.error instanceof ApiError && q.error.status === 404) return <NotFoundPage />;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
        <Link to="/nodes">
          <ArrowLeft />
          {t("节点")}
        </Link>
      </Button>
      {q.isPending ? (
        <DetailSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("节点信息加载失败")} />
      ) : (
        <NodeView node={q.data} />
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    </div>
  );
}

function NodeView({ node }: { node: NodeDetail }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [showTable, setShowTable] = React.useState(false);
  const state = nodeState(node);

  const toggle = useMutation({
    mutationFn: (isOn: boolean) => api.updateNode(node.id, { isOn }),
    onSuccess: (_r, isOn) => {
      toast.success(isOn ? t("节点已启用") : t("节点已停用"));
      void qc.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (e) => toastError(e, "操作失败"),
  });

  function askToggle() {
    if (!node.isOn) {
      toggle.mutate(true);
      return;
    }
    confirm({
      title: t("停用节点 {{name}}？", { name: node.name }),
      description: t("停用后节点会从集群 DNS 解析中摘除，不再承载流量。已建立的连接会在数分钟内迁移到其他节点。"),
      confirmText: t("停用"),
      destructive: true,
      onConfirm: () => toggle.mutateAsync(false),
    });
  }

  function askDelete() {
    confirm({
      title: t("删除节点 {{name}}？", { name: node.name }),
      description: t("节点会立即从集群中移除，安装凭据随之失效。此操作不可撤销。"),
      confirmText: t("删除节点"),
      destructive: true,
      confirmPhrase: node.name,
      confirmPhraseLabel: (
        <>
          {t("请输入")} <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{node.name}</code> {t("以确认")}
        </>
      ),
      onConfirm: async () => {
        try {
          await api.deleteNode(node.id);
        } catch (e) {
          toastError(e, "删除失败");
          throw e;
        }
        toast.success(t("节点已删除"));
        qc.removeQueries({ queryKey: ["nodes", "detail", node.id] });
        void qc.invalidateQueries({ queryKey: ["nodes"] });
        void qc.invalidateQueries({ queryKey: ["clusters"] });
        navigate("/nodes", { replace: true });
      },
    });
  }

  const step = node.series.length > 1 ? node.series[1]!.t - node.series[0]!.t : 600;
  const fmtTime = timeLabel(step, locale);
  const fmtTip = tooltipTimeLabel(step, locale);
  const pctData = node.series.map((p) => ({ t: p.t, cpu: p.cpu * 100, memory: p.memory * 100, bandwidthBps: p.bandwidthBps, connections: p.connections }));
  const pct = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}%`;

  return (
    <>
      <PageHeader
        className="pb-0"
        title={
          <span className="flex items-center gap-3">
            {node.name}
            <NodeStatusBadge node={node} />
          </span>
        }
        description={[node.region, node.clusterName, node.version ? `edge-node v${node.version}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <Button variant="outline" onClick={askToggle} loading={toggle.isPending}>
              {node.isOn ? <CirclePause /> : <CirclePlay />}
              {node.isOn ? t("停用") : t("启用")}
            </Button>
            <Button variant="destructive-outline" onClick={askDelete}>
              <Trash2 />
              {t("删除")}
            </Button>
          </>
        }
      />

      {state === "offline" ? (
        <div role="alert" className="flex gap-3 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-[13px] text-destructive-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("节点离线")}</div>
            <div className="mt-0.5 opacity-90">
              {t("最后一次心跳在 {{time}}，节点已从 DNS 解析中摘除。请检查服务器网络与 edge-node 进程。", {
                time: formatRelative(node.updatedAt, locale),
              })}
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-6">
          <Info label={t("IP 地址")} className="col-span-2 md:col-span-1 xl:col-span-2">
            <div className="space-y-1">
              {node.ips.map((ip) => (
                <div key={ip} className="group flex items-center gap-1">
                  <span className="truncate font-mono text-[13px]">{ip}</span>
                  <CopyButton value={ip} className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
                </div>
              ))}
            </div>
          </Info>
          <Info label="CPU">
            <UsageMeter value={node.cpu} />
          </Info>
          <Info label={t("内存")}>
            <UsageMeter value={node.memory} />
          </Info>
          <Info label={t("负载 (1m)")}>
            <span className="tabular">{node.load1 == null ? "—" : node.load1.toFixed(2)}</span>
          </Info>
          <Info label={t("最后心跳")}>
            <span className="tabular" title={formatDateTime(node.updatedAt, locale)}>
              {node.updatedAt ? formatRelative(node.updatedAt, locale) : t("从未")}
            </span>
          </Info>
          <Info label={t("出口带宽")}>
            <span className="tabular">{formatBits(node.bandwidthBps)}</span>
          </Info>
          <Info label={t("连接数")}>
            <span className="tabular">{formatNumber(node.connections, locale)}</span>
          </Info>
          <Info label={t("集群")}>{node.clusterName}</Info>
          <Info label={t("地区")}>{node.region || "—"}</Info>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-[15px] font-semibold tracking-tight">{t("运行指标")}</h2>
            <p className="text-[13px] text-muted-foreground">{t("近 24 小时，每 10 分钟一个采样点")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowTable((v) => !v)} className={showTable ? "bg-accent" : ""}>
            <Table2 />
            {showTable ? t("显示图表") : t("数据表")}
          </Button>
        </div>
        {node.series.length === 0 ? (
          <Card>
            <EmptyState compact title={t("暂无指标")} description={t("节点上线后开始采集运行指标。")} />
          </Card>
        ) : showTable ? (
          <ChartTable
            className="max-h-[420px] bg-card"
            columns={[
              { key: "t", label: t("时间") },
              { key: "cpu", label: "CPU", align: "right" },
              { key: "memory", label: t("内存"), align: "right" },
              { key: "bw", label: t("出口带宽"), align: "right" },
              { key: "conn", label: t("连接数"), align: "right" },
            ]}
            rows={[...pctData].reverse().map((p) => ({
              t: fmtTip(p.t),
              cpu: pct(p.cpu),
              memory: pct(p.memory),
              bw: formatBits(p.bandwidthBps),
              conn: formatNumber(p.connections, locale),
            }))}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title={t("CPU 使用率")}>
              <TimeSeriesChart data={pctData} series={[{ key: "cpu", label: "CPU" }]} kind="line" height={220} formatValue={pct} formatAxisValue={(v) => `${v}%`} formatTime={fmtTime} formatTooltipTime={fmtTip} />
            </ChartCard>
            <ChartCard title={t("内存使用率")}>
              <TimeSeriesChart
                data={pctData}
                series={[{ key: "memory", label: t("内存"), color: "var(--chart-7)" }]}
                kind="line"
                height={220}
                formatValue={pct}
                formatAxisValue={(v) => `${v}%`}
                formatTime={fmtTime}
                formatTooltipTime={fmtTip}
              />
            </ChartCard>
            <ChartCard title={t("出口带宽")}>
              <TimeSeriesChart
                data={pctData}
                series={[{ key: "bandwidthBps", label: t("出口带宽"), color: "var(--chart-3)" }]}
                height={220}
                formatValue={(v) => formatBits(v)}
                formatAxisValue={bitsAxis}
                formatTime={fmtTime}
                formatTooltipTime={fmtTip}
              />
            </ChartCard>
            <ChartCard title={t("连接数")}>
              <TimeSeriesChart
                data={pctData}
                series={[{ key: "connections", label: t("连接数"), color: "var(--chart-2)" }]}
                kind="line"
                height={220}
                formatValue={(v) => formatNumber(v, locale)}
                formatTime={fmtTime}
                formatTooltipTime={fmtTip}
              />
            </ChartCard>
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Waypoints className="size-4 text-muted-foreground" />
            {t("DNS 记录")}
          </CardTitle>
          <CardDescription>{t("由集群 DNS 设置自动维护，节点离线或停用时会被摘除")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {node.dnsRecords.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">
              {!node.isOn ? t("节点已停用，不参与 DNS 解析。") : state === "offline" ? t("节点离线，解析记录已暂时摘除，恢复心跳后会自动加回。") : (
                <>
                  {t("该节点暂无解析记录。请确认集群已绑定 DNS 域名。")}{" "}
                  <Link to="/clusters" className="font-medium text-primary hover:underline">
                    {t("前往集群设置")}
                  </Link>
                </>
              )}
            </p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {node.dnsRecords.map((r) => (
                <li key={r} className="group flex items-center gap-2 bg-subtle px-3.5 py-2.5 font-mono text-[12.5px]">
                  <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{r}</span>
                  <CopyButton value={r.replace(/\s+/g, " ")} className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {dialog}
    </>
  );
}

function Info({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
