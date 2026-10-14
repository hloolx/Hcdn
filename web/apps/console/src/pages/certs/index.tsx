import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import type { Cert } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Pagination } from "@hcdn/ui/blocks/pagination";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { Badge } from "@hcdn/ui/components/badge";
import { Button } from "@hcdn/ui/components/button";
import { Card } from "@hcdn/ui/components/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hcdn/ui/components/dropdown-menu";
import { InputGroup } from "@hcdn/ui/components/input";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { toast } from "@hcdn/ui/components/toaster";
import { Hint } from "@hcdn/ui/components/tooltip";
import { cn } from "@hcdn/ui/lib/cn";
import { formatDate } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { certExpiry } from "@/lib/cert";
import { currentLocale } from "@/lib/i18n";
import { UploadCertDialog } from "./upload-dialog";
import { AcmeDialog } from "./acme-dialog";

const PAGE_SIZE = 20;

export function CertsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [keyword, setKeyword] = React.useState("");
  const [kw, setKw] = React.useState("");
  const [upload, setUpload] = React.useState(false);
  const [acme, setAcme] = React.useState(false);
  const { confirm, dialog } = useConfirm();

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setKw(keyword.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [keyword]);

  const q = useQuery({
    queryKey: ["certs", { kw, page }],
    queryFn: () => api.certs({ keyword: kw || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (c: Cert) => api.deleteCert(c.id),
    onSuccess: (_d, c) => {
      void qc.invalidateQueries({ queryKey: ["certs"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      toast.success(t("已删除证书 {{name}}", { name: c.name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function askDelete(c: Cert) {
    if (c.sitesCount > 0) {
      confirm({
        title: t("无法删除正在使用的证书"),
        description: t("该证书正被 {{n}} 个网站使用。请先在这些网站的 HTTPS 设置中更换证书或改为自动申请，然后再删除。", { n: c.sitesCount }),
        confirmText: t("知道了"),
        cancelText: t("关闭"),
        onConfirm: () => undefined,
      });
      return;
    }
    confirm({
      title: t("删除证书 {{name}}？", { name: c.name }),
      description: t("证书和私钥将从平台永久删除，无法恢复。"),
      confirmText: t("删除"),
      cancelText: t("取消"),
      destructive: true,
      onConfirm: () => remove.mutateAsync(c),
    });
  }

  const data = q.data;
  const rows = data?.items ?? [];
  const noneAtAll = data && data.total === 0 && !kw;
  const expiring = rows.filter((c) => certExpiry(c).days >= 0 && certExpiry(c).days <= 30).length;

  return (
    <div>
      <PageHeader
        title={t("证书")}
        description={t("管理网站使用的 HTTPS 证书。免费证书会在到期前 30 天自动续期。")}
        actions={
          <>
            {noneAtAll ? null : (
              <InputGroup
                className="w-full sm:w-56"
                leading={<Search />}
                trailing={
                  keyword ? (
                    <button type="button" onClick={() => setKeyword("")} className="rounded p-0.5 hover:text-foreground" aria-label={t("清除")}>
                      <X className="size-3.5" />
                    </button>
                  ) : null
                }
                placeholder={t("搜索域名")}
                aria-label={t("搜索域名")}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            )}
            <Button variant="outline" onClick={() => setUpload(true)}>
              <Upload />
              {t("上传证书")}
            </Button>
            <Button onClick={() => setAcme(true)}>
              <Plus />
              {t("申请免费证书")}
            </Button>
          </>
        }
      />

      {expiring > 0 ? (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-warning/30 bg-warning-soft/60 px-4 py-2.5 text-[13px]">
          <RefreshCw className="size-4 shrink-0 text-warning-foreground" />
          <span>
            {t("{{n}} 张证书将在 30 天内到期。", { n: expiring })}
            <span className="text-muted-foreground">{t("开启自动续期的证书会自动处理；上传的证书需要你手动更新。")}</span>
          </span>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {q.error && !data ? (
          <ErrorState title={t("证书列表加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
        ) : noneAtAll ? (
          <EmptyState
            className="py-16"
            icon={<ShieldCheck />}
            title={t("还没有证书")}
            description={t("为网站申请免费的 Let's Encrypt 证书，或上传你已有的证书。")}
            action={
              <>
                <Button variant="outline" onClick={() => setUpload(true)}>
                  <Upload />
                  {t("上传证书")}
                </Button>
                <Button onClick={() => setAcme(true)}>
                  <Plus />
                  {t("申请免费证书")}
                </Button>
              </>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("域名")}</TableHead>
                    <TableHead>{t("颁发者")}</TableHead>
                    <TableHead>{t("到期时间")}</TableHead>
                    <TableHead>{t("来源")}</TableHead>
                    <TableHead>{t("自动续期")}</TableHead>
                    <TableHead className="text-right">{t("使用网站")}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{t("操作")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={cn(q.isPlaceholderData && "opacity-60")}>
                  {q.isPending
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i} className="hover:bg-transparent">
                          {[40, 28, 24, 12, 12, 8].map((w, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4" style={{ width: `${w * 4}px` }} />
                            </TableCell>
                          ))}
                          <TableCell />
                        </TableRow>
                      ))
                    : rows.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <CertDomains cert={c} />
                          </TableCell>
                          <TableCell className="text-[13px] text-muted-foreground">{c.issuer}</TableCell>
                          <TableCell>
                            <Expiry cert={c} />
                          </TableCell>
                          <TableCell>
                            <SourceBadge cert={c} />
                          </TableCell>
                          <TableCell className="text-[13px]">{c.autoRenew ? t("已开启") : <span className="text-muted-foreground">{t("未开启")}</span>}</TableCell>
                          <TableCell className="text-right tabular">{c.sitesCount > 0 ? c.sitesCount : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="pl-0">
                            <RowMenu cert={c} onDelete={askDelete} />
                          </TableCell>
                        </TableRow>
                      ))}
                  {!q.isPending && rows.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7}>
                        <EmptyState compact icon={<Search />} title={t("没有匹配的证书")} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {q.isPending
                ? Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="space-y-2 p-4">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </li>
                  ))
                : rows.map((c) => (
                    <li key={c.id} className="flex gap-3 p-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        <CertDomains cert={c} />
                        <div className="flex flex-wrap items-center gap-2">
                          <Expiry cert={c} />
                          <SourceBadge cert={c} />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.issuer} · {t("{{n}} 个网站使用", { n: c.sitesCount })}
                        </div>
                      </div>
                      <RowMenu cert={c} onDelete={askDelete} />
                    </li>
                  ))}
              {!q.isPending && rows.length === 0 ? <EmptyState compact icon={<Search />} title={t("没有匹配的证书")} /> : null}
            </ul>
            {data && data.total > PAGE_SIZE ? (
              <div className="border-t px-5 py-3">
                <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} summary={(f, to, total) => t("第 {{from}}–{{to}} 张，共 {{total}} 张", { from: f, to, total })} />
              </div>
            ) : null}
          </>
        )}
      </Card>

      <UploadCertDialog open={upload} onOpenChange={setUpload} />
      <AcmeDialog open={acme} onOpenChange={setAcme} />
      {dialog}
    </div>
  );
}

function CertDomains({ cert }: { cert: Cert }) {
  const extra = cert.domains.slice(1);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-[13px] font-medium">{cert.domains[0] ?? cert.name}</span>
      {extra.length ? (
        <Hint label={<span className="grid gap-0.5 font-mono">{extra.map((d) => <span key={d}>{d}</span>)}</span>}>
          <button type="button" className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground hover:text-foreground">
            +{extra.length}
          </button>
        </Hint>
      ) : null}
    </div>
  );
}

function Expiry({ cert }: { cert: Cert }) {
  const { t } = useTranslation();
  const { days, tone } = certExpiry(cert);
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="text-[13px] tabular">{formatDate(cert.notAfter, currentLocale())}</span>
      <StatusBadge tone={tone}>{days < 0 ? t("已过期 {{n}} 天", { n: -days }) : t("剩余 {{n}} 天", { n: days })}</StatusBadge>
    </div>
  );
}

function SourceBadge({ cert }: { cert: Cert }) {
  const { t } = useTranslation();
  return cert.isAcme ? (
    <Badge variant="soft" className="rounded-md">
      ACME
    </Badge>
  ) : (
    <Badge variant="outline" className="rounded-md text-muted-foreground">
      {t("上传")}
    </Badge>
  );
}

function RowMenu({ cert, onDelete }: { cert: Cert; onDelete: (c: Cert) => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("更多操作")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(cert)}>
          <Trash2 />
          {t("删除")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
