import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Ban, ExternalLink, Globe, Lock, LockOpen, MoreHorizontal, Play, Plus, Search, Trash2, X } from "lucide-react";
import type { Site } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { CopyButton } from "@hcdn/ui/blocks/status";
import { Pagination } from "@hcdn/ui/blocks/pagination";
import { Button } from "@hcdn/ui/components/button";
import { Card } from "@hcdn/ui/components/card";
import { InputGroup } from "@hcdn/ui/components/input";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Hint } from "@hcdn/ui/components/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hcdn/ui/components/dropdown-menu";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBytes, formatCount, formatDate } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { originLabel, primaryDomain } from "@/lib/site";
import { SiteStatusBadge, useSiteActions } from "@/components/site-actions";

const PAGE_SIZE = 10;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SitesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const [keyword, setKeyword] = React.useState(params.get("q") ?? "");
  const kw = useDebounced(keyword.trim());
  const actions = useSiteActions();

  React.useEffect(() => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (kw) next.set("q", kw);
        else next.delete("q");
        if ((p.get("q") ?? "") !== kw) next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [kw, setParams]);

  const q = useQuery({
    queryKey: ["sites", { kw, page }],
    queryFn: () => api.sites({ keyword: kw || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = q.data;
  const noSitesAtAll = data && data.total === 0 && !kw;

  function setPage(p: number) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p > 1) next.set("page", String(p));
      else next.delete("page");
      return next;
    });
  }

  const header = (
    <PageHeader
      title={t("网站")}
      description={t("管理接入加速的域名、源站与配置")}
      actions={
        noSitesAtAll ? null : (
          <>
            <InputGroup
              className="min-w-0 flex-1 sm:w-64 sm:flex-none"
              leading={<Search />}
              trailing={
                keyword ? (
                  <button type="button" onClick={() => setKeyword("")} className="rounded p-0.5 hover:text-foreground" aria-label={t("清除")}>
                    <X className="size-3.5" />
                  </button>
                ) : null
              }
              placeholder={t("搜索域名或 CNAME")}
              aria-label={t("搜索域名或 CNAME")}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button asChild>
              <Link to="/sites/new">
                <Plus />
                {t("添加网站")}
              </Link>
            </Button>
          </>
        )
      }
    />
  );

  if (q.error && !data) {
    return (
      <div>
        {header}
        <Card>
          <ErrorState title={t("网站列表加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
        </Card>
      </div>
    );
  }

  if (noSitesAtAll) {
    return (
      <div>
        {header}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(50%_60%_at_50%_45%,black,transparent)]" aria-hidden />
          <EmptyState
            className="relative py-20"
            icon={<Globe />}
            title={t("还没有网站")}
            description={t("添加你的域名和源站地址，几分钟内即可开始通过全球边缘节点加速访问。")}
            action={
              <Button asChild>
                <Link to="/sites/new">
                  <Plus />
                  {t("添加第一个网站")}
                </Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const rows = data?.items ?? [];
  const open = (s: Site) => navigate(`/sites/${s.id}`);
  const fromRow = (e: React.MouseEvent) => !(e.target as HTMLElement).closest("a,button,[role=menuitem],[role=menu]");

  return (
    <div>
      {header}
      <Card className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[24%]">{t("域名")}</TableHead>
                <TableHead>{t("状态")}</TableHead>
                <TableHead>CNAME</TableHead>
                <TableHead className="hidden xl:table-cell">{t("源站")}</TableHead>
                <TableHead>HTTPS</TableHead>
                <TableHead className="text-right">{t("24 小时流量")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("操作")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={cn(q.isPlaceholderData && "opacity-60 transition-opacity")}>
              {q.isPending
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell>
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="mt-1.5 h-3 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-44" />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-4 w-36" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-14" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="ml-auto h-4 w-16" />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))
                : rows.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={(e) => fromRow(e) && open(s)}>
                      <TableCell className="max-w-0">
                        <DomainCell site={s} />
                      </TableCell>
                      <TableCell>
                        <SiteStatusBadge status={s.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <span className="max-w-56 truncate font-mono text-[12.5px] text-muted-foreground">{s.cname}</span>
                          <CopyButton value={s.cname} successText={t("已复制")} />
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-64 xl:table-cell">
                        <OriginCell site={s} />
                      </TableCell>
                      <TableCell>
                        <HttpsCell site={s} />
                      </TableCell>
                      <TableCell className="text-right tabular">
                        <TrafficCell site={s} />
                      </TableCell>
                      <TableCell className="pl-0">
                        <RowMenu site={s} onToggle={actions.askToggle} onDelete={actions.askDelete} />
                      </TableCell>
                    </TableRow>
                  ))}
              {!q.isPending && rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <NoMatch keyword={kw} onClear={() => setKeyword("")} />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="divide-y md:hidden">
          {q.isPending
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2.5 p-4">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-56" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ))
            : rows.map((s) => (
                <div key={s.id} className="flex gap-3 p-4" onClick={(e) => fromRow(e) && open(s)}>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <DomainCell site={s} compact />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SiteStatusBadge status={s.status} />
                      <HttpsCell site={s} />
                    </div>
                    <div className="flex items-center gap-0.5">
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{s.cname}</span>
                      <CopyButton value={s.cname} successText={t("已复制")} />
                    </div>
                    <div className="text-xs text-muted-foreground tabular">
                      {t("24 小时")} · {s.traffic24h ? `${formatBytes(s.traffic24h.bytes)} · ${t("{{n}} 次请求", { n: formatCount(s.traffic24h.requests, currentLocale()) })}` : t("暂无流量")}
                    </div>
                  </div>
                  <RowMenu site={s} onToggle={actions.askToggle} onDelete={actions.askDelete} />
                </div>
              ))}
          {!q.isPending && rows.length === 0 ? <NoMatch keyword={kw} onClear={() => setKeyword("")} /> : null}
        </div>

        {data && data.total > 0 ? (
          <div className="border-t px-5 py-3">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              onPageChange={setPage}
              summary={(from, to, total) => t("第 {{from}}–{{to}} 个，共 {{total}} 个网站", { from, to, total })}
              prevLabel={t("上一页")}
              nextLabel={t("下一页")}
            />
          </div>
        ) : null}
      </Card>
      {actions.dialog}
    </div>
  );
}

function NoMatch({ keyword, onClear }: { keyword: string; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      compact
      icon={<Search />}
      title={t("没有匹配的网站")}
      description={t("没有找到包含“{{kw}}”的域名或 CNAME。", { kw: keyword })}
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          {t("清除搜索")}
        </Button>
      }
    />
  );
}

function DomainCell({ site, compact }: { site: Site; compact?: boolean }) {
  const { t } = useTranslation();
  const extra = site.domains.slice(1);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link to={`/sites/${site.id}`} className={cn("truncate font-medium hover:underline", compact && "text-[15px]")}>
          {primaryDomain(site)}
        </Link>
        {extra.length > 0 ? (
          <Hint
            label={
              <span className="grid gap-0.5 font-mono">
                {extra.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            }
          >
            <button type="button" className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground hover:text-foreground">
              +{extra.length}
            </button>
          </Hint>
        ) : null}
      </div>
      {!compact ? (
        <div className="mt-0.5 text-xs text-muted-foreground tabular">
          {t("创建于 {{date}}", { date: formatDate(site.createdAt, currentLocale()) })}
        </div>
      ) : null}
    </div>
  );
}

function OriginCell({ site }: { site: Site }) {
  const first = site.origins[0];
  if (!first) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-[12.5px]">{originLabel(first)}</span>
      {site.origins.length > 1 ? (
        <Hint label={<span className="grid gap-0.5 font-mono">{site.origins.slice(1).map((o) => <span key={originLabel(o)}>{originLabel(o)}</span>)}</span>}>
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">+{site.origins.length - 1}</span>
        </Hint>
      ) : null}
    </div>
  );
}

function HttpsCell({ site }: { site: Site }) {
  const { t } = useTranslation();
  if (!site.https.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <LockOpen className="size-3.5" />
        {t("未启用")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <Lock className="size-3.5 text-success" />
      {site.https.forceRedirect ? t("强制 HTTPS") : t("已启用")}
    </span>
  );
}

function TrafficCell({ site }: { site: Site }) {
  const { t } = useTranslation();
  if (!site.traffic24h) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <div className="font-medium">{formatBytes(site.traffic24h.bytes)}</div>
      <div className="text-xs text-muted-foreground">{t("{{n}} 次请求", { n: formatCount(site.traffic24h.requests, currentLocale()) })}</div>
    </div>
  );
}

function RowMenu({ site, onToggle, onDelete }: { site: Site; onToggle: (s: Site) => void; onDelete: (s: Site) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("更多操作")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => navigate(`/sites/${site.id}`)}>
          <ExternalLink />
          {t("查看详情")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onToggle(site)}>
          {site.isOn ? <Ban /> : <Play />}
          {site.isOn ? t("停用") : t("启用")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(site)}>
          <Trash2 />
          {t("删除")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
