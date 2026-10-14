import * as React from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUp, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import type { CacheRule, CacheSettings } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { Field, SettingRow } from "@hcdn/ui/blocks/field";
import { SaveBar } from "@hcdn/ui/blocks/save-bar";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { Badge } from "@hcdn/ui/components/badge";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@hcdn/ui/components/dropdown-menu";
import { Input } from "@hcdn/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Switch } from "@hcdn/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { SettingsSkeleton } from "./https";
import { useSite } from "./layout";

type MatchType = CacheRule["match"]["type"];

const MATCH_LABEL: Record<MatchType, string> = { all: "全部请求", extension: "文件扩展名", path_prefix: "路径前缀", regex: "正则表达式" };

const UNITS = [
  { value: 86400, label: "天" },
  { value: 3600, label: "小时" },
  { value: 60, label: "分钟" },
  { value: 1, label: "秒" },
] as const;

const TTL_PRESETS = [0, 600, 3600, 86400, 7 * 86400, 30 * 86400];

export function formatTtl(seconds: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (seconds <= 0) return t("不缓存");
  for (const u of UNITS) {
    if (seconds % u.value === 0) return `${seconds / u.value} ${t(u.label)}`;
  }
  return `${seconds} ${t("秒")}`;
}

export function SiteCacheTab() {
  const { t } = useTranslation();
  const site = useSite();
  const q = useQuery({ queryKey: ["site-cache", site.id], queryFn: () => api.cache(site.id) });
  if (q.error && !q.data) return <ErrorState title={t("缓存设置加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />;
  if (!q.data) return <SettingsSkeleton />;
  return <CacheForm key={JSON.stringify(q.data)} siteId={site.id} initial={q.data} />;
}

let ruleSeq = 1;

function CacheForm({ siteId, initial }: { siteId: number; initial: CacheSettings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = React.useState(initial);
  const [editing, setEditing] = React.useState<CacheRule | "new" | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const mutation = useMutation({
    mutationFn: () => api.updateCache(siteId, v),
    onSuccess: (res) => {
      qc.setQueryData(["site-cache", siteId], res);
      toast.success(t("缓存设置已保存"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const setRules = (fn: (rules: CacheRule[]) => CacheRule[]) => setV((s) => ({ ...s, rules: fn(s.rules) }));
  const move = (i: number, d: -1 | 1) =>
    setRules((rules) => {
      const next = [...rules];
      const [r] = next.splice(i, 1);
      next.splice(i + d, 0, r!);
      return next;
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-0">
          <SettingRow title={<label htmlFor="cache-on">{t("启用缓存")}</label>} description={t("关闭后所有请求都会回源，仅保留加速线路与安全防护。")}>
            <Switch id="cache-on" checked={v.enabled} onCheckedChange={(c) => setV((s) => ({ ...s, enabled: c }))} />
          </SettingRow>
        </CardContent>
      </Card>

      <Card className={cn(!v.enabled && "opacity-60")}>
        <CardHeader className="border-b">
          <CardTitle>{t("缓存规则")}</CardTitle>
          <CardDescription>{t("自上而下匹配，第一条命中的规则生效；未命中任何规则时遵循源站的 Cache-Control。")}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setEditing("new")} disabled={!v.enabled}>
              <Plus />
              {t("添加规则")}
            </Button>
          </CardAction>
        </CardHeader>
        {v.rules.length === 0 ? (
          <EmptyState
            compact
            icon={<Zap />}
            title={t("还没有缓存规则")}
            description={t("添加规则，为图片、脚本等静态资源设置更长的缓存时间。")}
            action={
              <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={!v.enabled}>
                <Plus />
                {t("添加规则")}
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("匹配条件")}</TableHead>
                <TableHead>{t("缓存时间")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("忽略查询参数")}</TableHead>
                <TableHead>{t("启用")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("操作")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.rules.map((r, i) => (
                <TableRow key={r.id} className={cn(!r.enabled && "text-muted-foreground")}>
                  <TableCell className="text-xs text-muted-foreground tabular">{i + 1}</TableCell>
                  <TableCell className="max-w-0 min-w-56 whitespace-normal">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                        {t(MATCH_LABEL[r.match.type])}
                      </Badge>
                      {r.match.type === "all" ? null : <span className="truncate font-mono text-[12.5px]" title={r.match.value}>{r.match.type === "extension" ? r.match.value.split(",").map((x) => `.${x.trim()}`).join(" ") : r.match.value}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.ttlSeconds > 0 ? <span className="font-medium tabular">{formatTtl(r.ttlSeconds, t)}</span> : <Badge variant="secondary">{t("不缓存")}</Badge>}
                  </TableCell>
                  <TableCell className="hidden text-[13px] md:table-cell">{r.ignoreQuery ? t("是") : <span className="text-muted-foreground">{t("否")}</span>}</TableCell>
                  <TableCell>
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(c) => setRules((rules) => rules.map((x) => (x.id === r.id ? { ...x, enabled: c } : x)))}
                      aria-label={t("启用规则 {{n}}", { n: i + 1 })}
                      disabled={!v.enabled}
                    />
                  </TableCell>
                  <TableCell className="pl-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("更多操作")} disabled={!v.enabled}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onSelect={() => setEditing(r)}>
                          <Pencil />
                          {t("编辑")}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, -1)}>
                          <ArrowUp />
                          {t("上移")}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === v.rules.length - 1} onSelect={() => move(i, 1)}>
                          <ArrowDown />
                          {t("下移")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setRules((rules) => rules.filter((x) => x.id !== r.id))}>
                          <Trash2 />
                          {t("删除")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border bg-subtle/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
            <RefreshCw className="size-4" />
          </span>
          <div>
            <div className="text-[13px] font-medium">{t("内容更新后需要立即生效？")}</div>
            <div className="text-[13px] text-muted-foreground">{t("修改规则只影响之后的请求。已缓存的文件可以通过刷新缓存立即清除。")}</div>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0 self-start sm:self-auto">
          <Link to="/cache">
            {t("刷新缓存")}
            <ArrowRight />
          </Link>
        </Button>
      </div>

      <RuleDialog
        rule={editing}
        onClose={() => setEditing(null)}
        onSave={(rule) => {
          setRules((rules) => (rules.some((x) => x.id === rule.id) ? rules.map((x) => (x.id === rule.id ? rule : x)) : [...rules, rule]));
          setEditing(null);
        }}
      />
      <SaveBar open={dirty} saving={mutation.isPending} onSave={() => mutation.mutate()} onReset={() => setV(initial)} message={t("缓存设置有未保存的更改")} saveLabel={t("保存更改")} resetLabel={t("放弃")} />
    </div>
  );
}

function matchError(type: MatchType, value: string): string | null {
  const v = value.trim();
  if (type === "all") return null;
  if (!v) return "请填写匹配内容";
  if (type === "extension") return v.split(",").every((x) => /^[a-z0-9]{1,10}$/i.test(x.trim().replace(/^\./, ""))) ? null : "扩展名只能包含字母和数字，用逗号分隔";
  if (type === "path_prefix") return v.startsWith("/") ? null : "路径需以 / 开头";
  try {
    new RegExp(v);
    return null;
  } catch {
    return "正则表达式语法错误";
  }
}

function RuleDialog({ rule, onClose, onSave }: { rule: CacheRule | "new" | null; onClose: () => void; onSave: (r: CacheRule) => void }) {
  const { t } = useTranslation();
  const open = rule != null;
  const base: CacheRule = rule && rule !== "new" ? rule : { id: `new-${ruleSeq++}`, match: { type: "extension", value: "" }, ttlSeconds: 86400, ignoreQuery: false, enabled: true };
  const [draft, setDraft] = React.useState(base);
  const [unit, setUnit] = React.useState<number>(86400);
  const [amount, setAmount] = React.useState("1");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDraft(base);
    const u = UNITS.find((x) => base.ttlSeconds > 0 && base.ttlSeconds % x.value === 0) ?? UNITS[1];
    setUnit(u.value);
    setAmount(base.ttlSeconds > 0 ? String(base.ttlSeconds / u.value) : "0");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule]);

  const ttl = Math.max(0, Math.round(Number(amount || 0) * unit));
  const err = matchError(draft.match.type, draft.match.value);
  const ttlErr = ttl > 365 * 86400 ? "缓存时间最长 365 天" : null;

  function pickPreset(seconds: number) {
    const u = UNITS.find((x) => seconds > 0 && seconds % x.value === 0) ?? UNITS[1];
    setUnit(u.value);
    setAmount(seconds > 0 ? String(seconds / u.value) : "0");
  }

  const placeholder: Record<MatchType, string> = { all: "", extension: "jpg,png,css,js", path_prefix: "/static/", regex: "^/assets/.*\\.(js|css)$" };
  const hint: Record<MatchType, string> = {
    all: "匹配所有请求，通常放在最后作为默认规则。",
    extension: "多个扩展名用逗号分隔，不区分大小写。",
    path_prefix: "匹配以该路径开头的 URL，例如 /static/。",
    regex: "对 URL 路径（不含域名和参数）进行匹配，使用 RE2 语法。",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule === "new" ? t("添加缓存规则") : t("编辑缓存规则")}</DialogTitle>
          <DialogDescription>{t("命中规则的请求会在边缘节点缓存指定的时间。")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (err || ttlErr) return;
            onSave({ ...draft, match: { ...draft.match, value: draft.match.type === "all" ? "" : draft.match.value.trim().replace(/\s+/g, "") }, ttlSeconds: ttl });
          }}
        >
          <Field label={t("匹配方式")} htmlFor="match-type">
            <Select value={draft.match.type} onValueChange={(x) => setDraft((d) => ({ ...d, match: { type: x as MatchType, value: x === "all" ? "" : d.match.value } }))}>
              <SelectTrigger id="match-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MATCH_LABEL) as MatchType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(MATCH_LABEL[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {draft.match.type !== "all" ? (
            <Field label={t("匹配内容")} htmlFor="match-value" error={touched && err ? t(err) : undefined} description={t(hint[draft.match.type])}>
              <Input
                id="match-value"
                value={draft.match.value}
                onChange={(e) => setDraft((d) => ({ ...d, match: { ...d.match, value: e.target.value } }))}
                placeholder={placeholder[draft.match.type]}
                className="font-mono text-[13px]"
                aria-invalid={touched && !!err}
                autoFocus
              />
            </Field>
          ) : (
            <p className="-mt-2 text-[12.5px] text-muted-foreground">{t(hint.all)}</p>
          )}
          <Field label={t("缓存时间")} error={ttlErr ? t(ttlErr) : undefined} description={ttl === 0 ? t("命中的请求不缓存，始终回源。") : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {TTL_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => pickPreset(p)}
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                    ttl === p ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-background text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  {formatTtl(p, t)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 6))} inputMode="numeric" className="w-28 tabular" aria-label={t("缓存时间数值")} />
              <Select value={String(unit)} onValueChange={(x) => setUnit(Number(x))}>
                <SelectTrigger className="w-28" aria-label={t("缓存时间单位")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u.value} value={String(u.value)}>
                      {t(u.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>
          <label className="flex items-start justify-between gap-6 rounded-lg border p-3">
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{t("忽略查询参数")}</span>
              <span className="block text-[12.5px] leading-relaxed text-muted-foreground">{t("把 /a.js?v=1 与 /a.js?v=2 视为同一个文件，提高命中率。URL 参数决定内容时不要开启。")}</span>
            </span>
            <Switch checked={draft.ignoreQuery} onCheckedChange={(c) => setDraft((d) => ({ ...d, ignoreQuery: c }))} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("取消")}
            </Button>
            <Button type="submit">{rule === "new" ? t("添加") : t("完成")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
