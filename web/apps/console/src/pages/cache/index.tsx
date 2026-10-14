import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleAlert, Flame, History, Info, RefreshCw } from "lucide-react";
import type { CacheQuota, CacheTask } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Pagination } from "@hcdn/ui/blocks/pagination";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { StatusBadge, type StatusTone } from "@hcdn/ui/blocks/status";
import { Meter } from "@hcdn/ui/charts/bar-list";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Progress } from "@hcdn/ui/components/misc";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { Tabs, TabsList, TabsTrigger } from "@hcdn/ui/components/tabs";
import { Textarea } from "@hcdn/ui/components/textarea";
import { toast } from "@hcdn/ui/components/toaster";
import { Hint } from "@hcdn/ui/components/tooltip";
import { cn } from "@hcdn/ui/lib/cn";
import { formatDateTime, formatNumber, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { lines, urlError } from "@/lib/validate";
import { useSiteOptions } from "@/components/site-picker";

const PAGE_SIZE = 10;

export function CachePage() {
  const { t } = useTranslation();
  const quota = useQuery({ queryKey: ["cache-quota"], queryFn: api.cacheQuota });
  return (
    <div className="space-y-6">
      <PageHeader className="pb-0" title={t("缓存")} description={t("内容更新后刷新边缘节点上的缓存，或在发布前把文件预热到边缘节点。")} />
      <div className="flex flex-col gap-4 rounded-xl border bg-subtle/60 p-4 md:flex-row md:items-center md:gap-6">
        <QuotaWidget quota={quota.data} loading={quota.isPending} />
        <div className="grid flex-1 gap-2 text-[13px] leading-relaxed text-muted-foreground sm:grid-cols-2 md:border-l md:pl-6">
          <p>
            <span className="font-medium text-foreground">{t("刷新")}</span> — {t("让已缓存的旧文件失效。适合修改了文件但 URL 不变的情况，如 index.html、未带版本号的脚本。")}
          </p>
          <p>
            <span className="font-medium text-foreground">{t("预热")}</span> — {t("主动把文件提前缓存到边缘节点。适合即将被大量访问的新文件，避免首批访客集中回源。")}
          </p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PurgeCard quota={quota.data} />
        <PreheatCard quota={quota.data} />
      </div>
      <TaskHistory />
    </div>
  );
}

function QuotaWidget({ quota, loading }: { quota?: CacheQuota; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return <Skeleton className="h-12 w-full rounded-lg md:w-72" />;
  if (!quota) return <div className="w-full shrink-0 text-[13px] text-muted-foreground md:w-72">{t("暂时无法获取今日额度")}</div>;
  const ratio = quota.usedToday / quota.maxKeysPerDay;
  return (
    <div className="w-full shrink-0 md:w-72">
      <Meter
        value={ratio}
        tone={ratio > 0.9 ? "danger" : ratio > 0.7 ? "warning" : "primary"}
        label={
          <>
            <span>{t("今日额度")}</span>
            <span className="tabular">
              <span className="font-medium text-foreground">{formatNumber(quota.usedToday)}</span> / {formatNumber(quota.maxKeysPerDay)} {t("条")}
            </span>
          </>
        }
      />
      <div className="mt-1.5 text-[11.5px] text-muted-foreground">{t("刷新与预热共用额度，每日 0 点（UTC+8）重置")}</div>
    </div>
  );
}

/** Validates each line: URL syntax, prefix shape, host belongs to one of the user's sites. */
function useTargets(text: string, prefix: boolean) {
  const sites = useSiteOptions();
  const domains = React.useMemo(() => (sites.data?.items ?? []).flatMap((s) => s.domains), [sites.data]);
  const owns = (host: string) => domains.some((d) => d === host || (d.startsWith("*.") && host.endsWith(d.slice(1))));
  const items = lines(text);
  const errors = items
    .map((l) => {
      const e = urlError(l, prefix);
      if (e) return { line: l, error: e };
      if (domains.length && !owns(new URL(l).hostname)) return { line: l, error: "域名不属于你的网站" };
      return null;
    })
    .filter((x): x is { line: string; error: string } => x != null);
  return { items, errors };
}

function TargetsEditor({
  id,
  value,
  onChange,
  placeholder,
  count,
  max,
  errors,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: number;
  max: number;
  errors: { line: string; error: string }[];
}) {
  const { t } = useTranslation();
  const over = count > max;
  return (
    <div className="grid gap-2">
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={7}
        spellCheck={false}
        aria-invalid={errors.length > 0 || over}
        aria-describedby={`${id}-help`}
        className="font-mono text-[12.5px] leading-6 placeholder:text-muted-foreground/60"
      />
      <div id={`${id}-help`} className="flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0 text-destructive-foreground">
          {errors.length > 0 ? (
            <span className="flex gap-1.5">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-all">
                <span className="font-mono">{errors[0]!.line}</span>：{t(errors[0]!.error)}
                {errors.length > 1 ? t("（另有 {{n}} 行有误）", { n: errors.length - 1 }) : ""}
              </span>
            </span>
          ) : over ? (
            t("单次最多提交 {{max}} 条", { max })
          ) : null}
        </div>
        <span className={cn("shrink-0 tabular", over ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>
          {count} / {max}
        </span>
      </div>
    </div>
  );
}

function useSubmitTask() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["cache-tasks"] });
    void qc.invalidateQueries({ queryKey: ["cache-quota"] });
  };
}

function PurgeCard({ quota }: { quota?: CacheQuota }) {
  const { t } = useTranslation();
  const [keyType, setKeyType] = React.useState<"url" | "prefix">("url");
  const [text, setText] = React.useState("");
  const { items, errors } = useTargets(text, keyType === "prefix");
  const max = quota?.maxKeysPerTask ?? 100;
  const left = quota ? quota.maxKeysPerDay - quota.usedToday : Infinity;
  const done = useSubmitTask();
  const mutation = useMutation({
    mutationFn: () => api.purge({ keyType, targets: items }),
    onSuccess: () => {
      done();
      setText("");
      toast.success(t("已提交刷新任务，通常 1 分钟内全网生效"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disabled = items.length === 0 || errors.length > 0 || items.length > max || items.length > left;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            <RefreshCw className="size-4" />
          </span>
          <div className="space-y-1">
            <CardTitle>{t("刷新缓存")}</CardTitle>
            <CardDescription>{t("删除边缘节点上的缓存，下次访问时回源获取最新内容。")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={keyType} onValueChange={(v) => setKeyType(v as "url" | "prefix")}>
          <TabsList>
            <TabsTrigger value="url">{t("按 URL")}</TabsTrigger>
            <TabsTrigger value="prefix">{t("按目录")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <TargetsEditor
          id="purge-targets"
          value={text}
          onChange={setText}
          count={items.length}
          max={max}
          errors={errors}
          placeholder={keyType === "url" ? "https://www.example.com/index.html\nhttps://static.example.com/app.js" : "https://static.example.com/assets/\nhttps://img.example.com/banners/"}
        />
        <p className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          {keyType === "url" ? t("每行一个完整 URL，查询参数不同视为不同文件。") : t("每行一个以 / 结尾的目录，目录下的所有文件都会被刷新，一个目录计 1 条额度。")}
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={() => mutation.mutate()} disabled={disabled} loading={mutation.isPending}>
          {t("提交刷新")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PreheatCard({ quota }: { quota?: CacheQuota }) {
  const { t } = useTranslation();
  const [text, setText] = React.useState("");
  const { items, errors } = useTargets(text, false);
  const max = quota?.maxKeysPerTask ?? 100;
  const left = quota ? quota.maxKeysPerDay - quota.usedToday : Infinity;
  const done = useSubmitTask();
  const mutation = useMutation({
    mutationFn: () => api.preheat(items),
    onSuccess: () => {
      done();
      setText("");
      toast.success(t("已提交预热任务"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disabled = items.length === 0 || errors.length > 0 || items.length > max || items.length > left;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-warning-soft text-warning-foreground">
            <Flame className="size-4" />
          </span>
          <div className="space-y-1">
            <CardTitle>{t("预热缓存")}</CardTitle>
            <CardDescription>{t("提前把文件拉取到边缘节点，首次访问也能命中缓存。")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-9 items-center text-[13px] text-muted-foreground">{t("适合大版本发布、活动页面上线或安装包、视频等大文件。")}</div>
        <TargetsEditor id="preheat-targets" value={text} onChange={setText} count={items.length} max={max} errors={errors} placeholder={"https://download.example.com/app/v2.5.0/setup.exe\nhttps://video.example.net/intro/1080p.mp4"} />
        <p className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          {t("预热会产生回源流量，请避开源站高峰期；文件更新后请先刷新再预热。")}
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={() => mutation.mutate()} disabled={disabled} loading={mutation.isPending}>
          {t("提交预热")}
        </Button>
      </CardFooter>
    </Card>
  );
}

const TASK_STATUS: Record<CacheTask["status"], { label: string; tone: StatusTone; pulse?: boolean }> = {
  pending: { label: "排队中", tone: "neutral", pulse: true },
  running: { label: "进行中", tone: "info", pulse: true },
  done: { label: "已完成", tone: "success" },
  failed: { label: "部分失败", tone: "danger" },
};

function taskType(task: CacheTask, t: (k: string) => string) {
  if (task.type === "preheat") return t("预热");
  return task.keyType === "prefix" ? t("刷新目录") : t("刷新 URL");
}

function TaskHistory() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [page, setPage] = React.useState(1);
  const q = useQuery({
    queryKey: ["cache-tasks", page],
    queryFn: () => api.cacheTasks({ page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((x) => x.status === "pending" || x.status === "running") ? 1500 : false),
  });
  const rows = q.data?.items ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <CardTitle>{t("任务记录")}</CardTitle>
        <CardDescription>{t("最近 30 天提交的刷新与预热任务")}</CardDescription>
      </CardHeader>
      {q.error && !q.data ? (
        <ErrorState title={t("任务记录加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
      ) : !q.isPending && rows.length === 0 ? (
        <EmptyState compact icon={<History />} title={t("还没有任务")} description={t("提交的刷新与预热任务会显示在这里。")} />
      ) : (
        <>
          <ul className="divide-y md:hidden">
            {rows.map((task) => {
              const st = TASK_STATUS[task.status];
              return (
                <li key={task.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{taskType(task, t)}</span>
                    <StatusBadge tone={st.tone} pulse={st.pulse}>
                      {t(st.label)}
                    </StatusBadge>
                  </div>
                  <div className="truncate font-mono text-xs">
                    {task.targets[0]}
                    {task.targets.length > 1 ? <span className="text-muted-foreground"> +{task.targets.length - 1}</span> : null}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground tabular">
                    <span>
                      {task.done}/{task.total}
                    </span>
                    <span>{formatRelative(task.createdAt, locale)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("类型")}</TableHead>
                <TableHead>{t("内容")}</TableHead>
                <TableHead>{t("状态")}</TableHead>
                <TableHead className="min-w-40">{t("进度")}</TableHead>
                <TableHead className="text-right">{t("提交时间")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending
                ? Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-72" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-2 w-32" /></TableCell>
                      <TableCell><Skeleton className="ml-auto h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                : rows.map((task) => {
                    const st = TASK_STATUS[task.status];
                    const pct = task.total ? (task.done / task.total) * 100 : 0;
                    return (
                      <TableRow key={task.id}>
                        <TableCell className="text-[13px] font-medium">{taskType(task, t)}</TableCell>
                        <TableCell className="max-w-0 min-w-56">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-mono text-[12.5px]">{task.targets[0]}</span>
                            {task.targets.length > 1 ? (
                              <Hint label={<span className="grid max-h-60 gap-0.5 overflow-hidden font-mono">{task.targets.slice(1, 12).map((x) => <span key={x}>{x}</span>)}{task.targets.length > 12 ? <span>…</span> : null}</span>}>
                                <button type="button" className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground hover:text-foreground">
                                  +{task.targets.length - 1}
                                </button>
                              </Hint>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={st.tone} pulse={st.pulse}>
                            {t(st.label)}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Progress
                              value={pct}
                              className="h-1.5 w-28"
                              indicatorClassName={task.status === "failed" ? "bg-destructive" : task.status === "done" ? "bg-success" : undefined}
                              aria-label={t("进度")}
                            />
                            <span className="text-xs text-muted-foreground tabular">
                              {task.done}/{task.total}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-[13px] text-muted-foreground" title={formatDateTime(task.createdAt, locale)}>
                          {formatRelative(task.createdAt, locale)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
          {q.data && q.data.total > PAGE_SIZE ? (
            <div className="border-t px-5 py-3">
              <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPageChange={setPage} summary={(f, to, total) => t("第 {{from}}–{{to}} 条，共 {{total}} 条", { from: f, to, total })} />
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
