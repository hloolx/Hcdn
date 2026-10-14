import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Loader2, Search, ShieldCheck } from "lucide-react";
import type { AcmeTask } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { Button } from "@hcdn/ui/components/button";
import { Checkbox } from "@hcdn/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { InputGroup } from "@hcdn/ui/components/input";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { useSiteOptions } from "@/components/site-picker";
import { SiteStatusBadge } from "@/components/site-actions";

const MAX = 10;

export function AcmeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sites = useSiteOptions();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState("");
  const [taskId, setTaskId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) {
      setSelected([]);
      setQuery("");
      setTaskId(null);
    }
  }, [open]);

  const request = useMutation({
    mutationFn: () => api.requestAcme({ domains: selected }),
    onSuccess: (task) => setTaskId(task.id),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const task = useQuery({
    queryKey: ["acme-task", taskId],
    queryFn: () => api.acmeTask(taskId!),
    enabled: taskId != null,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "success" || q.state.data.status === "failed") ? false : 1000),
  });

  React.useEffect(() => {
    if (task.data?.status === "success") {
      void qc.invalidateQueries({ queryKey: ["certs"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    }
  }, [task.data?.status, qc]);

  const q = query.trim().toLowerCase();
  const groups = (sites.data?.items ?? [])
    .map((s) => ({ site: s, domains: s.domains.filter((d) => !q || d.includes(q)) }))
    .filter((g) => g.domains.length > 0);
  const toggle = (d: string) => setSelected((s) => (s.includes(d) ? s.filter((x) => x !== d) : s.length >= MAX ? s : [...s, d]));
  const running = taskId != null;

  return (
    <Dialog open={open} onOpenChange={(o) => !request.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("申请免费证书")}</DialogTitle>
          <DialogDescription>{t("通过 Let's Encrypt 签发，有效期 90 天，到期前自动续期。域名需已 CNAME 到 CDN 才能完成验证。")}</DialogDescription>
        </DialogHeader>
        {running ? (
          <TaskProgress task={task.data} domains={selected} />
        ) : (
          <div className="grid gap-3">
            <InputGroup leading={<Search />} placeholder={t("搜索域名")} aria-label={t("搜索域名")} value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="max-h-72 overflow-y-auto rounded-xl border scrollbar-thin">
              {sites.isPending ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-7" />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">{q ? t("没有匹配的域名") : t("还没有网站，请先添加网站")}</div>
              ) : (
                groups.map(({ site, domains }) => (
                  <div key={site.id} className="border-b last:border-0">
                    <div className="flex items-center justify-between gap-2 bg-subtle/70 px-3 py-1.5 text-xs text-muted-foreground">
                      <span className="truncate">{site.name}</span>
                      {site.status !== "active" ? <SiteStatusBadge status={site.status} /> : null}
                    </div>
                    {domains.map((d) => {
                      const wildcard = d.startsWith("*.");
                      const id = `acme-${site.id}-${d}`;
                      const checked = selected.includes(d);
                      return (
                        <label
                          key={d}
                          htmlFor={id}
                          className={cn("flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-accent/60", wildcard ? "cursor-not-allowed opacity-60" : "cursor-pointer")}
                        >
                          <Checkbox id={id} checked={checked} disabled={wildcard || (!checked && selected.length >= MAX)} onCheckedChange={() => toggle(d)} />
                          <span className="min-w-0 flex-1 truncate font-mono">{d}</span>
                          {wildcard ? <span className="text-xs text-muted-foreground">{t("需 DNS 验证，暂不支持")}</span> : null}
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular">{t("已选择 {{n}}/{{max}} 个域名", { n: selected.length, max: MAX })}</span>
              {selected.length ? (
                <button type="button" className="hover:text-foreground" onClick={() => setSelected([])}>
                  {t("清空")}
                </button>
              ) : null}
            </div>
          </div>
        )}
        <DialogFooter>
          {running ? (
            task.data?.status === "failed" ? (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  {t("关闭")}
                </Button>
                <Button variant="outline" onClick={() => setTaskId(null)}>
                  {t("返回修改")}
                </Button>
              </>
            ) : (
              <Button onClick={() => onOpenChange(false)} variant={task.data?.status === "success" ? "default" : "outline"}>
                {task.data?.status === "success" ? t("完成") : t("后台运行")}
              </Button>
            )
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("取消")}
              </Button>
              <Button onClick={() => request.mutate()} disabled={selected.length === 0} loading={request.isPending}>
                {t("申请证书")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskProgress({ task, domains }: { task?: AcmeTask; domains: string[] }) {
  const { t } = useTranslation();
  const status = task?.status ?? "pending";
  const steps = [
    { label: t("提交申请"), done: true },
    { label: t("HTTP-01 域名验证"), done: status === "running" ? false : status === "success" || status === "failed", active: status === "pending" || status === "running" },
    { label: t("签发并部署证书"), done: status === "success", active: false },
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-subtle/60 p-3">
        <div className="mb-1 text-xs text-muted-foreground">{t("域名")}</div>
        <div className="flex flex-wrap gap-1.5">
          {domains.map((d) => (
            <span key={d} className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[12px]">
              {d}
            </span>
          ))}
        </div>
      </div>
      {status === "failed" ? (
        <div role="alert" className="flex gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-[13px] text-destructive-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("申请失败")}</div>
            <div className="mt-0.5">{task?.error}</div>
          </div>
        </div>
      ) : status === "success" ? (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft/60 px-3.5 py-3">
          <ShieldCheck className="size-5 shrink-0 text-success-foreground" />
          <div className="text-[13px]">
            <div className="font-medium">{t("证书已签发")}</div>
            <div className="text-muted-foreground">{t("可在网站的 HTTPS 设置中选择使用，到期前会自动续期。")}</div>
          </div>
        </div>
      ) : (
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 text-[13px]">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border",
                  s.done ? "border-success bg-success text-white" : s.active ? "border-primary text-primary" : "text-muted-foreground",
                )}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : s.active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-[11px]">{i + 1}</span>}
              </span>
              <span className={cn(s.done || s.active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            </li>
          ))}
          <li className="pl-9 text-xs text-muted-foreground">{t("通常在 1 分钟内完成，可以关闭对话框，任务会在后台继续。")}</li>
        </ol>
      )}
    </div>
  );
}
