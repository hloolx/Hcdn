import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Award, RefreshCw, SearchX, Upload } from "lucide-react";
import type { AdminCert } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { Badge } from "@hcdn/ui/components/badge";
import { Button } from "@hcdn/ui/components/button";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { cn } from "@hcdn/ui/lib/cn";
import { daysUntil, formatDate } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { useUrlFilters } from "@/lib/hooks";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { TableCard } from "@/components/table-card";

const PAGE_SIZE = 20;

function Expiry({ cert }: { cert: AdminCert }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const days = daysUntil(cert.notAfter) ?? 0;
  const tone = days < 0 ? "danger" : days <= 14 ? "warning" : days <= 30 ? "soon" : "ok";
  return (
    <div>
      <div
        className={cn(
          "text-[13px] font-medium tabular",
          tone === "danger" && "text-destructive-foreground",
          tone === "warning" && "text-warning-foreground",
          tone === "soon" && "text-foreground",
          tone === "ok" && "text-success-foreground",
        )}
      >
        {days < 0 ? t("已过期 {{n}} 天", { n: -days }) : days === 0 ? t("今天到期") : t("剩余 {{n}} 天", { n: days })}
      </div>
      <div className="text-xs text-muted-foreground tabular">{formatDate(cert.notAfter, locale)}</div>
    </div>
  );
}

export function CertsPage() {
  const { t } = useTranslation();
  const { values, page, set } = useUrlFilters(["keyword"] as const);
  const q = useQuery({
    queryKey: ["certs", "list", values.keyword, page],
    queryFn: () => api.certs({ keyword: values.keyword || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader title={t("证书")} description={t("所有租户的 TLS 证书，按到期时间排序。ACME 证书会在到期前 30 天自动续期。")} />
      <TableCard
        toolbar={
          <>
            <SearchInput value={values.keyword} onChange={(v) => set({ keyword: v })} placeholder={t("搜索域名、所有者或颁发者")} />
            {q.data ? <span className="ml-auto text-[13px] text-muted-foreground tabular">{t("共 {{n}} 张证书", { n: q.data.total })}</span> : null}
          </>
        }
        footer={q.data && q.data.total > 0 ? <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => set({ page: p })} /> : null}
      >
        {q.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("证书列表加载失败")} />
        ) : items.length === 0 ? (
          values.keyword ? (
            <EmptyState
              icon={<SearchX />}
              title={t("没有匹配的证书")}
              action={
                <Button variant="outline" size="sm" onClick={() => set({ keyword: "" })}>
                  {t("清除搜索")}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<Award />} title={t("还没有证书")} description={t("用户为网站开启 HTTPS 后，证书会显示在这里。")} />
          )
        ) : (
          <Table className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("域名")}</TableHead>
                <TableHead>{t("所有者")}</TableHead>
                <TableHead>{t("颁发者")}</TableHead>
                <TableHead>{t("来源")}</TableHead>
                <TableHead>{t("到期")}</TableHead>
                <TableHead className="text-right">{t("关联网站")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="max-w-72 truncate font-medium">{c.domains[0]}</div>
                    {c.domains.length > 1 ? (
                      <div className="max-w-72 truncate text-xs text-muted-foreground" title={c.domains.slice(1).join("\n")}>
                        {c.domains.slice(1).join(", ")}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Link to={`/users?keyword=${encodeURIComponent(c.username)}`} className="text-[13px] hover:underline">
                      {c.username}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-[13px] text-muted-foreground" title={c.issuer}>
                    {c.issuer}
                  </TableCell>
                  <TableCell>
                    {c.isAcme ? (
                      <Badge variant="soft" title={c.autoRenew ? t("自动续期已开启") : undefined}>
                        <RefreshCw />
                        ACME
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        <Upload />
                        {t("上传")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Expiry cert={c} />
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular">{c.sitesCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
