import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bot, ScrollText, SearchX, ShieldUser, User } from "lucide-react";
import type { AuditLog } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { StatusBadge, type StatusTone } from "@hcdn/ui/blocks/status";
import { Button } from "@hcdn/ui/components/button";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { cn } from "@hcdn/ui/lib/cn";
import { formatDateTime, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { useUrlFilters } from "@/lib/hooks";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { TableCard } from "@/components/table-card";

const PAGE_SIZE = 30;
type ActorFilter = "" | AuditLog["actorType"];

const ACTOR: Record<AuditLog["actorType"], { label: string; icon: typeof User; className: string }> = {
  admin: { label: "管理员", icon: ShieldUser, className: "bg-admin-accent-soft text-admin-accent" },
  user: { label: "用户", icon: User, className: "bg-muted text-muted-foreground" },
  system: { label: "系统", icon: Bot, className: "bg-info-soft text-info-foreground" },
};

const LEVEL: Record<AuditLog["level"], { tone: StatusTone; label: string }> = {
  info: { tone: "neutral", label: "信息" },
  warning: { tone: "warning", label: "警告" },
  error: { tone: "danger", label: "错误" },
};

export function AuditLogsPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { values, page, set } = useUrlFilters(["actorType", "keyword"] as const);
  const actorType = (["admin", "user", "system"].includes(values.actorType) ? values.actorType : "") as ActorFilter;
  const q = useQuery({
    queryKey: ["audit-logs", actorType, values.keyword, page],
    queryFn: () => api.auditLogs({ actorType: actorType || undefined, keyword: values.keyword || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const items = q.data?.items ?? [];
  const filtered = !!(actorType || values.keyword);

  return (
    <div>
      <PageHeader title={t("审计日志")} description={t("管理员、用户与系统的关键操作记录，用于安全审计与问题追溯。")} />
      <TableCard
        toolbar={
          <>
            <Segmented
              size="sm"
              value={actorType}
              onChange={(v) => set({ actorType: v })}
              options={[
                { value: "", label: t("全部") },
                { value: "admin", label: t("管理员") },
                { value: "user", label: t("用户") },
                { value: "system", label: t("系统") },
              ]}
            />
            <SearchInput className="sm:ml-auto" value={values.keyword} onChange={(v) => set({ keyword: v })} placeholder={t("搜索操作、操作者或 IP")} />
          </>
        }
        footer={q.data && q.data.total > 0 ? <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => set({ page: p })} /> : null}
      >
        {q.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("审计日志加载失败")} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<SearchX />}
              title={t("没有匹配的记录")}
              action={
                <Button variant="outline" size="sm" onClick={() => set({ actorType: "", keyword: "" })}>
                  {t("清除筛选")}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<ScrollText />} title={t("暂无审计日志")} description={t("管理员与用户的关键操作会记录在这里。")} />
          )
        ) : (
          <Table className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-44">{t("时间")}</TableHead>
                <TableHead className="w-52">{t("操作者")}</TableHead>
                <TableHead>{t("操作")}</TableHead>
                <TableHead className="w-48">IP</TableHead>
                <TableHead className="w-20 text-right">{t("级别")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((l) => {
                const a = ACTOR[l.actorType];
                const lv = LEVEL[l.level];
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-[13px] tabular">
                      <span title={formatRelative(l.time, locale)}>{formatDateTime(l.time, locale)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium", a.className)}>
                          <a.icon className="size-3" />
                          {t(a.label)}
                        </span>
                        <span className="truncate text-[13px] font-medium">{l.actor}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[28rem] truncate text-[13px]" title={l.action}>
                      {l.action}
                    </TableCell>
                    <TableCell className="font-mono text-[12.5px] text-muted-foreground">{l.ip || "—"}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge tone={lv.tone}>{t(lv.label)}</StatusBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
