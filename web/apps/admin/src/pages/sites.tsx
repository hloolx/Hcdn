import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Globe, SearchX } from "lucide-react";
import type { AdminSite, SiteStatus } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { CopyButton, StatusBadge, type StatusTone } from "@hcdn/ui/blocks/status";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { Button } from "@hcdn/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Switch } from "@hcdn/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBytes, formatDate } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { toastError, useUrlFilters } from "@/lib/hooks";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { TableCard } from "@/components/table-card";

const PAGE_SIZE = 20;

export const SITE_STATUS: Record<SiteStatus, { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "运行中" },
  pending_dns: { tone: "warning", label: "待解析" },
  disabled: { tone: "neutral", label: "已停用" },
  error: { tone: "danger", label: "异常" },
};

export function SitesPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const { values, page, set } = useUrlFilters(["userId", "keyword"] as const);
  const users = useQuery({ queryKey: ["users", "options"], queryFn: () => api.users({ pageSize: 500 }), staleTime: 5 * 60_000 });
  const q = useQuery({
    queryKey: ["sites", "list", values.userId, values.keyword, page],
    queryFn: () => api.sites({ userId: values.userId ? Number(values.userId) : undefined, keyword: values.keyword || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: ({ id, isOn }: { id: number; isOn: boolean }) => api.updateSite(id, { isOn }),
    onSuccess: (s) => {
      toast.success(s.isOn ? t("已启用 {{d}}", { d: s.domains[0] }) : t("已停用 {{d}}", { d: s.domains[0] }));
      void qc.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (e) => toastError(e, "操作失败"),
  });

  function onToggle(s: AdminSite, isOn: boolean) {
    const domain = s.domains[0] ?? s.name;
    confirm(
      isOn
        ? {
            title: t("启用网站 {{d}}？", { d: domain }),
            description: t("边缘节点将重新为该网站提供加速服务。"),
            confirmText: t("启用"),
            onConfirm: () => toggle.mutateAsync({ id: s.id, isOn }),
          }
        : {
            title: t("停用网站 {{d}}？", { d: domain }),
            description: t("停用后边缘节点将不再为该网站提供服务，仍解析到 CNAME 的访客将无法访问。用户会在控制台看到网站已被管理员停用。"),
            confirmText: t("停用"),
            destructive: true,
            onConfirm: () => toggle.mutateAsync({ id: s.id, isOn }),
          },
    );
  }

  const items = q.data?.items ?? [];
  const filtered = !!(values.userId || values.keyword);

  return (
    <div>
      <PageHeader title={t("网站")} description={t("所有租户的加速网站。管理员可在此停用违规或异常的网站。")} />
      <TableCard
        toolbar={
          <>
            <Select value={values.userId || "all"} onValueChange={(v) => set({ userId: v === "all" ? "" : v })}>
              <SelectTrigger size="sm" className="w-full sm:w-52">
                <SelectValue placeholder={t("全部用户")} />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="all">{t("全部用户")}</SelectItem>
                {(users.data?.items ?? []).map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.username}
                    {u.fullname ? <span className="text-xs text-muted-foreground">{u.fullname}</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchInput value={values.keyword} onChange={(v) => set({ keyword: v })} placeholder={t("搜索域名或 CNAME")} />
            {q.data ? <span className="ml-auto hidden text-[13px] text-muted-foreground tabular sm:inline">{t("共 {{n}} 个网站", { n: q.data.total })}</span> : null}
          </>
        }
        footer={q.data && q.data.total > 0 ? <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => set({ page: p })} /> : null}
      >
        {q.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("网站列表加载失败")} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchX />}
              title={t("没有匹配的网站")}
              description={t("试试调整筛选条件或关键词。")}
              action={
                <Button variant="outline" size="sm" onClick={() => set({ userId: "", keyword: "" })}>
                  {t("清除筛选")}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<Globe />} title={t("还没有网站")} description={t("用户在控制台添加网站后会显示在这里。")} />
          )
        ) : (
          <Table className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("域名")}</TableHead>
                <TableHead>{t("所有者")}</TableHead>
                <TableHead>{t("集群")}</TableHead>
                <TableHead>{t("状态")}</TableHead>
                <TableHead>CNAME</TableHead>
                <TableHead className="text-right">{t("24 小时流量")}</TableHead>
                <TableHead>{t("创建时间")}</TableHead>
                <TableHead className="text-right">{t("启用")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => {
                const st = SITE_STATUS[s.status];
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="max-w-64 truncate font-medium">{s.domains[0]}</span>
                        {s.domains.length > 1 ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={s.domains.slice(1).join("\n")}>
                            +{s.domains.length - 1}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link to={`/sites?userId=${s.userId}`} className="text-[13px] hover:underline">
                        {s.username}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{s.clusterName}</TableCell>
                    <TableCell>
                      <StatusBadge tone={st.tone}>{t(st.label)}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="group flex items-center gap-1">
                        <span className="max-w-52 truncate font-mono text-[12.5px] text-muted-foreground">{s.cname}</span>
                        <CopyButton value={s.cname} className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular">{s.traffic24h ? formatBytes(s.traffic24h.bytes) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground tabular">{formatDate(s.createdAt, locale)}</TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={s.isOn}
                        disabled={toggle.isPending && toggle.variables?.id === s.id}
                        onCheckedChange={(v) => onToggle(s, v)}
                        aria-label={s.isOn ? t("停用") : t("启用")}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {dialog}
    </div>
  );
}
