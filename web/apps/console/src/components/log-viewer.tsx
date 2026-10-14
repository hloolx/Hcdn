import * as React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Filter, RotateCw, ScrollText, Search, ShieldBan, X } from "lucide-react";
import type { AccessLog, AccessLogQuery } from "@hcdn/api/types";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { CopyButton } from "@hcdn/ui/blocks/status";
import { Badge } from "@hcdn/ui/components/badge";
import { Button } from "@hcdn/ui/components/button";
import { Card } from "@hcdn/ui/components/card";
import { InputGroup } from "@hcdn/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@hcdn/ui/components/sheet";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Hint } from "@hcdn/ui/components/tooltip";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBytes, formatMs } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { SitePicker } from "@/components/site-picker";

type Range = "15m" | "1h" | "24h" | "7d";
const RANGE_SECONDS: Record<Range, number> = { "15m": 900, "1h": 3600, "24h": 86400, "7d": 7 * 86400 };
const RANGES: { value: Range; label: string }[] = [
  { value: "15m", label: "15 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
];
const PAGE = 50;

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function statusTone(status: number) {
  if (status >= 500) return "text-destructive-foreground";
  if (status >= 400) return "text-warning-foreground";
  if (status >= 300) return "text-info-foreground";
  return "text-success-foreground";
}
const STATUS_DOT = (s: number) => (s >= 500 ? "bg-destructive" : s >= 400 ? "bg-warning" : s >= 300 ? "bg-info" : "bg-success");

function StatusCode({ status }: { status: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[12.5px] font-semibold tabular", statusTone(status))}>
      <span className={cn("size-1.5 rounded-full", STATUS_DOT(status))} />
      {status}
    </span>
  );
}

export function CacheBadge({ cache }: { cache: AccessLog["cache"] }) {
  if (cache === "-") return <span className="text-muted-foreground">—</span>;
  const variant = cache === "HIT" ? "success" : cache === "MISS" ? "warning" : "secondary";
  return (
    <Badge variant={variant} className="rounded-md px-1.5 font-mono text-[11px] font-semibold tracking-wide">
      {cache}
    </Badge>
  );
}

function timeParts(t: number, locale: string) {
  const d = new Date(t * 1000);
  const date = d.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return { date, time, ms: String(d.getMilliseconds()).padStart(3, "0") };
}

/**
 * Access log explorer: filter bar, dense table (cards on phones), cursor
 * pagination and a details sheet. With `siteId` the site filter is fixed.
 */
export function LogViewer({ siteId: fixedSiteId }: { siteId?: number }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [siteId, setSiteId] = React.useState<number | undefined>(fixedSiteId);
  const [range, setRange] = React.useState<Range>("24h");
  const [status, setStatus] = React.useState("all");
  const [ip, setIp] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [anchor, setAnchor] = React.useState(() => Math.floor(Date.now() / 1000));
  const [selected, setSelected] = React.useState<AccessLog | null>(null);
  const dIp = useDebounced(ip.trim());
  const dKw = useDebounced(keyword.trim());

  const filters: AccessLogQuery = {
    siteId: fixedSiteId ?? siteId,
    from: anchor - RANGE_SECONDS[range],
    to: anchor,
    status: status === "all" ? undefined : status,
    ip: dIp || undefined,
    keyword: dKw || undefined,
    size: PAGE,
  };
  const q = useInfiniteQuery({
    queryKey: ["logs", filters],
    queryFn: ({ pageParam }) => api.logs({ ...filters, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (prev) => prev,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = status !== "all" || !!dIp || !!dKw || (!fixedSiteId && siteId != null);

  function reset() {
    setStatus("all");
    setIp("");
    setKeyword("");
    if (!fixedSiteId) setSiteId(undefined);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        {fixedSiteId ? null : <SitePicker value={siteId} onChange={setSiteId} className="w-full lg:w-52" />}
        <Segmented value={range} onChange={(r) => { setRange(r); setAnchor(Math.floor(Date.now() / 1000)); }} options={RANGES.map((r) => ({ ...r, label: t(r.label) }))} className="w-fit" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full lg:w-36" aria-label={t("状态码")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("全部状态码")}</SelectItem>
            <SelectItem value="2xx">2xx {t("成功")}</SelectItem>
            <SelectItem value="3xx">3xx {t("重定向")}</SelectItem>
            <SelectItem value="4xx">4xx {t("客户端错误")}</SelectItem>
            <SelectItem value="5xx">5xx {t("服务端错误")}</SelectItem>
          </SelectContent>
        </Select>
        <InputGroup className="w-full lg:w-44" inputClassName="font-mono text-[13px] placeholder:font-sans" leading={<Filter />} placeholder={t("客户端 IP")} aria-label={t("客户端 IP")} value={ip} onChange={(e) => setIp(e.target.value)} />
        <InputGroup className="w-full lg:min-w-48 lg:flex-1" leading={<Search />} placeholder={t("搜索路径、域名或 User-Agent")} aria-label={t("关键词")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <div className="flex items-center gap-1">
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
              <X />
              {t("清除筛选")}
            </Button>
          ) : null}
          <Hint label={t("刷新")}>
            <Button variant="outline" size="icon" aria-label={t("刷新")} onClick={() => setAnchor(Math.floor(Date.now() / 1000))}>
              <RotateCw className={cn(q.isFetching && !q.isFetchingNextPage && "animate-spin")} />
            </Button>
          </Hint>
        </div>
      </div>

      <Card className="overflow-hidden">
        {q.error && !q.data ? (
          <ErrorState title={t("日志加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
        ) : q.isPending ? (
          <div className="divide-y">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-2.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-10" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-10" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title={filtered ? t("没有匹配的日志") : t("暂无访问日志")}
            description={filtered ? t("试试放宽时间范围或清除筛选条件。") : t("网站开始接收流量后，请求会在几秒内出现在这里。")}
            action={
              filtered ? (
                <Button variant="outline" size="sm" onClick={reset}>
                  {t("清除筛选")}
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {/* Desktop: dense table */}
            <div className={cn("hidden overflow-x-auto scrollbar-thin md:block", q.isPlaceholderData && "opacity-60")}>
              <table className="w-full text-[13px]">
                <thead className="bg-subtle/70 text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 pl-5 text-left font-medium whitespace-nowrap">{t("时间")}</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{t("客户端")}</th>
                    <th className="w-full px-3 py-2 text-left font-medium whitespace-nowrap">{t("请求")}</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{t("状态")}</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("大小")}</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{t("耗时")}</th>
                    <th className="py-2 pr-5 pl-3 text-left font-medium whitespace-nowrap">{t("缓存")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => {
                    const tp = timeParts(l.time, locale);
                    return (
                      <tr
                        key={l.id}
                        tabIndex={0}
                        onClick={() => setSelected(l)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(l))}
                        className={cn("cursor-pointer border-b outline-none last:border-0 hover:bg-subtle/80 focus-visible:bg-primary-soft/40", selected?.id === l.id && "bg-primary-soft/40")}
                      >
                        <td className="py-2 pr-3 pl-5 font-mono text-[12px] whitespace-nowrap text-muted-foreground tabular">
                          {tp.date} <span className="text-foreground">{tp.time}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-mono text-[12.5px]">{l.clientIp}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{l.region}</span>
                        </td>
                        <td className="max-w-0 min-w-64 px-3 py-2">
                          <Hint label={<span className="font-mono break-all">{`${l.scheme}://${l.host}${l.path}`}</span>}>
                            <div className="flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
                              <span className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground">{l.method}</span>
                              <span className="truncate">
                                <span className="text-muted-foreground">{l.host}</span>
                                {l.path}
                              </span>
                              {l.wafAction ? <ShieldBan className="size-3.5 shrink-0 text-destructive" aria-label="WAF" /> : null}
                            </div>
                          </Hint>
                        </td>
                        <td className="px-3 py-2">
                          <StatusCode status={l.status} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[12px] whitespace-nowrap tabular">{formatBytes(l.bytes)}</td>
                        <td className={cn("px-3 py-2 text-right font-mono text-[12px] whitespace-nowrap tabular", l.durationMs > 1000 && "text-warning-foreground")}>{formatMs(l.durationMs)}</td>
                        <td className="py-2 pr-5 pl-3">
                          <CacheBadge cache={l.cache} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phones: compact rows */}
            <ul className="divide-y md:hidden">
              {items.map((l) => {
                const tp = timeParts(l.time, locale);
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => setSelected(l)} className="w-full space-y-1 px-4 py-2.5 text-left hover:bg-subtle/80">
                      <div className="flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
                        <StatusCode status={l.status} />
                        <span className="text-[11px] font-semibold text-muted-foreground">{l.method}</span>
                        <span className="truncate">{l.path}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono tabular">{tp.time}</span>
                        <span className="truncate font-mono">{l.clientIp}</span>
                        <span className="ml-auto">
                          <CacheBadge cache={l.cache} />
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground">
              <span className="tabular">{t("已加载 {{n}} 条", { n: items.length })}</span>
              {q.hasNextPage ? (
                <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                  {t("加载更多")}
                </Button>
              ) : (
                <span>{t("没有更多了")}</span>
              )}
            </div>
          </>
        )}
      </Card>

      <LogSheet log={selected} onClose={() => setSelected(null)} onFilterIp={(v) => { setIp(v); setSelected(null); }} />
    </div>
  );
}

function LogSheet({ log, onClose, onFilterIp }: { log: AccessLog | null; onClose: () => void; onFilterIp: (ip: string) => void }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  // Keep the last log while the sheet animates out.
  const [shown, setShown] = React.useState(log);
  React.useEffect(() => {
    if (log) setShown(log);
  }, [log]);
  const l = log ?? shown;
  const url = l ? `${l.scheme}://${l.host}${l.path}` : "";
  const tp = l ? timeParts(l.time, locale) : null;
  const rows: [string, React.ReactNode, string?][] = l
    ? [
        [t("时间"), <span className="font-mono tabular">{new Date(l.time * 1000).toLocaleDateString(locale)} {tp!.time}.{tp!.ms}</span>],
        [t("客户端 IP"), <span className="font-mono">{l.clientIp}</span>, l.clientIp],
        [t("地区"), l.region || "—"],
        [t("方法"), <span className="font-mono">{l.method}</span>],
        [t("协议"), <span className="font-mono uppercase">{l.scheme}</span>],
        ["Host", <span className="font-mono">{l.host}</span>, l.host],
        [t("路径"), <span className="font-mono break-all">{l.path}</span>, l.path],
        [t("大小"), <span className="tabular">{formatBytes(l.bytes)}（{l.bytes.toLocaleString()} B）</span>],
        [t("耗时"), <span className="tabular">{formatMs(l.durationMs)}</span>],
        [t("缓存"), <CacheBadge cache={l.cache} />],
        ["WAF", l.wafAction ? <Badge variant="destructive">{l.wafAction === "block" ? t("已拦截") : l.wafAction === "rate_limit" ? t("频率限制") : l.wafAction}</Badge> : <span className="text-muted-foreground">{t("未触发")}</span>],
        ["User-Agent", <span className="font-mono text-[12px] break-all">{l.userAgent || "—"}</span>, l.userAgent || undefined],
        ["Referer", <span className="font-mono text-[12px] break-all">{l.referer || "—"}</span>, l.referer || undefined],
      ]
    : [];
  return (
    <Sheet open={!!log} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b pb-4">
          <SheetTitle className="flex items-center gap-2.5">
            {t("请求详情")}
            {l ? <StatusCode status={l.status} /> : null}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("单条访问日志的完整字段")}</SheetDescription>
          {l ? (
            <div className="mt-2 flex items-start gap-1 rounded-lg border bg-subtle p-2 pl-3">
              <span className="min-w-0 flex-1 font-mono text-[12.5px] leading-relaxed break-all">
                <span className="font-semibold text-muted-foreground">{l.method}</span> {url}
              </span>
              <CopyButton value={url} successText={t("已复制")} />
            </div>
          ) : null}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-3 scrollbar-thin">
          <dl className="divide-y">
            {rows.map(([k, v, copy]) => (
              <div key={k} className="grid grid-cols-[6.5rem_1fr_auto] items-start gap-3 py-2.5 text-[13px]">
                <dt className="pt-0.5 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 pt-0.5">{v}</dd>
                <div className="-my-1 w-7">{copy ? <CopyButton value={copy} successText={t("已复制")} /> : null}</div>
              </div>
            ))}
          </dl>
        </div>
        {l ? (
          <div className="flex gap-2 border-t p-4">
            <Button variant="outline" size="sm" onClick={() => onFilterIp(l.clientIp)}>
              <Filter />
              {t("只看此 IP")}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

