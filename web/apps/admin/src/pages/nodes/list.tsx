import { Link, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, SearchX, Server } from "lucide-react";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { Button } from "@hcdn/ui/components/button";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBits, formatNumber, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { useUrlFilters } from "@/lib/hooks";
import { ClusterSelect } from "@/components/cluster-select";
import { NodeStatusDot, nodeState } from "@/components/node-status";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { TableCard } from "@/components/table-card";
import { UsageMeter } from "@/components/usage-meter";
import { AddNodeDialog } from "./add-node-dialog";

const PAGE_SIZE = 20;
type StatusFilter = "" | "online" | "offline" | "disabled";

export function NodesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = currentLocale();
  const [params, setParams] = useSearchParams();
  const { values, page, set } = useUrlFilters(["clusterId", "status", "keyword"] as const);
  const status = (["online", "offline", "disabled"].includes(values.status) ? values.status : "") as StatusFilter;
  const filtered = !!(values.clusterId || status || values.keyword);

  const addOpen = params.get("add") === "1";
  const setAddOpen = (open: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set("add", "1");
        else next.delete("add");
        return next;
      },
      { replace: true },
    );

  const q = useQuery({
    queryKey: ["nodes", "list", values.clusterId, status, values.keyword, page],
    queryFn: () =>
      api.nodes({
        clusterId: values.clusterId ? Number(values.clusterId) : undefined,
        status: status || undefined,
        keyword: values.keyword || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t("节点")}
        description={t("边缘节点的在线状态、负载与流量。离线节点会自动从 DNS 解析中摘除。")}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            {t("添加节点")}
          </Button>
        }
      />

      <TableCard
        toolbar={
          <>
            <ClusterSelect size="sm" className="w-full sm:w-44" value={values.clusterId} onChange={(v) => set({ clusterId: v })} allLabel={t("全部集群")} />
            <Segmented
              size="sm"
              value={status}
              onChange={(v) => set({ status: v })}
              options={[
                { value: "", label: t("全部") },
                { value: "online", label: t("在线") },
                { value: "offline", label: t("离线") },
                { value: "disabled", label: t("已停用") },
              ]}
            />
            <SearchInput className="sm:ml-auto" value={values.keyword} onChange={(v) => set({ keyword: v })} placeholder={t("搜索名称、IP 或地区")} />
          </>
        }
        footer={q.data && q.data.total > 0 ? <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => set({ page: p })} /> : null}
      >
        {q.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("节点列表加载失败")} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchX />}
              title={t("没有匹配的节点")}
              description={t("试试调整筛选条件或关键词。")}
              action={
                <Button variant="outline" size="sm" onClick={() => set({ clusterId: "", status: "", keyword: "" })}>
                  {t("清除筛选")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Server />}
              title={t("还没有节点")}
              description={t("添加第一台边缘服务器，安装 edge-node 后即可开始承载流量。")}
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus />
                  {t("添加节点")}
                </Button>
              }
            />
          )
        ) : (
          <Table className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("节点")}</TableHead>
                <TableHead>{t("IP 地址")}</TableHead>
                <TableHead>{t("集群")}</TableHead>
                <TableHead>{t("地区")}</TableHead>
                <TableHead>{t("版本")}</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>{t("内存")}</TableHead>
                <TableHead className="text-right">{t("带宽")}</TableHead>
                <TableHead className="text-right">{t("连接数")}</TableHead>
                <TableHead className="text-right">{t("最后心跳")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((n) => {
                const s = nodeState(n);
                return (
                  <TableRow key={n.id} className="cursor-pointer" onClick={() => navigate(`/nodes/${n.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <NodeStatusDot node={n} />
                        <Link to={`/nodes/${n.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                          {n.name}
                        </Link>
                        {s === "pending" ? <span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info-foreground">{t("待安装")}</span> : null}
                        {s === "disabled" ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t("已停用")}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-[12.5px]">{n.ips[0] ?? "—"}</div>
                      {n.ips.length > 1 ? (
                        <div className="font-mono text-[11.5px] text-muted-foreground" title={n.ips.slice(1).join("\n")}>
                          {n.ips[1]}
                          {n.ips.length > 2 ? ` +${n.ips.length - 2}` : ""}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{n.clusterName}</TableCell>
                    <TableCell className="text-muted-foreground">{n.region || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{n.version ? `v${n.version}` : "—"}</TableCell>
                    <TableCell>
                      <UsageMeter value={n.cpu} />
                    </TableCell>
                    <TableCell>
                      <UsageMeter value={n.memory} />
                    </TableCell>
                    <TableCell className="text-right tabular">{formatBits(n.bandwidthBps)}</TableCell>
                    <TableCell className="text-right tabular">{formatNumber(n.connections, locale)}</TableCell>
                    <TableCell className={cn("text-right text-xs tabular", s === "offline" ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>
                      {n.updatedAt ? formatRelative(n.updatedAt, locale) : t("从未")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      <AddNodeDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
