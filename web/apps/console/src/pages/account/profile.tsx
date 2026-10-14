import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Activity, ArrowUpRight, Check, Globe, KeyRound, LogIn, Settings2, ShieldCheck, Trash2, Zap } from "lucide-react";
import type { ActivityItem, Me, Plan } from "@hcdn/api/types";
import { ApiError, errorMessage } from "@hcdn/api/client";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Field } from "@hcdn/ui/blocks/field";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { Meter } from "@hcdn/ui/charts/bar-list";
import { Badge } from "@hcdn/ui/components/badge";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput, PasswordStrength, passwordStrength } from "@hcdn/ui/components/password-input";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { formatBytes, formatDate, formatDateTime, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { currentLocale } from "@/lib/i18n";
import { AccountTabs } from "./tabs";

export function AccountPage() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <div>
      <PageHeader title={t("账号设置")} description={t("管理个人资料、登录密码与套餐。")} />
      <AccountTabs />
      {me.data ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <ProfileCard me={me.data} />
            <PasswordCard />
          </div>
          <div className="space-y-6">
            <PlanCard me={me.data} />
            <ActivityCard />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- profile

const profileSchema = z.object({
  fullname: z.string().trim().max(32, "姓名最多 32 个字符"),
  email: z.string().trim().email("请输入有效的邮箱地址"),
});
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { fullname: me.fullname, email: me.email } });
  const { errors, isDirty, isSubmitting } = form.formState;
  const msg = (m?: string) => (m ? t(m) : undefined);

  async function onSubmit(v: ProfileValues) {
    try {
      const next = await api.updateProfile({ fullname: v.fullname, email: v.email });
      qc.setQueryData(["me"], next);
      void qc.invalidateQueries({ queryKey: ["activity"] });
      form.reset({ fullname: next.fullname, email: next.email });
      toast.success(v.email !== me.email ? t("资料已保存，验证邮件已发送到新邮箱") : t("资料已保存"));
    } catch (e) {
      if (e instanceof ApiError) for (const [k, m] of Object.entries(e.fields)) if (k in v) form.setError(k as keyof ProfileValues, { message: m });
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader className="border-b">
          <CardTitle>{t("个人资料")}</CardTitle>
          <CardDescription>{t("用于账单、通知与找回密码。")}</CardDescription>
        </CardHeader>
        <CardContent className="grid items-start gap-5 sm:grid-cols-2">
          <Field label={t("用户名")} htmlFor="username" description={t("用户名用于登录，不可修改。")}>
            <Input id="username" value={me.username} readOnly disabled className="font-mono" />
          </Field>
          <Field label={t("姓名")} htmlFor="fullname" error={msg(errors.fullname?.message)}>
            <Input id="fullname" autoComplete="name" {...form.register("fullname")} aria-invalid={!!errors.fullname} />
          </Field>
          <Field
            className="sm:col-span-2"
            label={t("邮箱")}
            htmlFor="email"
            error={msg(errors.email?.message)}
            aside={me.emailVerified ? <StatusBadge tone="success">{t("已验证")}</StatusBadge> : <StatusBadge tone="warning">{t("未验证")}</StatusBadge>}
            description={t("修改邮箱后需要重新验证。")}
          >
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!errors.email} />
          </Field>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-xs text-muted-foreground">{t("注册于 {{date}}", { date: formatDate(me.createdAt, currentLocale()) })}</span>
          <div className="flex gap-2">
            {isDirty ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => form.reset()}>
                {t("取消")}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!isDirty} loading={isSubmitting}>
              {t("保存")}
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- password

const pwSchema = z
  .object({
    current: z.string().min(1, "请输入当前密码"),
    next: z.string().min(8, "密码至少 8 位").max(128, "密码过长"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "两次输入的密码不一致" })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "新密码不能与当前密码相同" })
  .refine((v) => passwordStrength(v.next).score >= 2, { path: ["next"], message: "密码强度太弱，请混合大小写字母、数字或符号" });
type PwValues = z.infer<typeof pwSchema>;

function PasswordCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm<PwValues>({ resolver: zodResolver(pwSchema), defaultValues: { current: "", next: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const next = form.watch("next");
  const msg = (m?: string) => (m ? t(m) : undefined);

  async function onSubmit(v: PwValues) {
    try {
      await api.changePassword(v.current, v.next);
      form.reset();
      void qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success(t("密码已修改，其他设备上的登录会话已退出"));
    } catch (e) {
      if (e instanceof ApiError && e.fields.currentPassword) form.setError("current", { message: e.fields.currentPassword });
      else toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader className="border-b">
          <CardTitle>{t("修改密码")}</CardTitle>
          <CardDescription>{t("修改后其他设备上的登录会话将被退出。")}</CardDescription>
        </CardHeader>
        <CardContent className="grid items-start gap-5 sm:grid-cols-2">
          <Field className="sm:col-span-2 sm:max-w-[calc(50%-0.625rem)]" label={t("当前密码")} htmlFor="pw-current" error={msg(errors.current?.message)}>
            <PasswordInput id="pw-current" autoComplete="current-password" {...form.register("current")} aria-invalid={!!errors.current} />
          </Field>
          <Field label={t("新密码")} htmlFor="pw-next" error={msg(errors.next?.message)}>
            <PasswordInput id="pw-next" autoComplete="new-password" {...form.register("next")} aria-invalid={!!errors.next} />
            <PasswordStrength value={next} />
          </Field>
          <Field label={t("确认新密码")} htmlFor="pw-confirm" error={msg(errors.confirm?.message)}>
            <PasswordInput id="pw-confirm" autoComplete="new-password" {...form.register("confirm")} aria-invalid={!!errors.confirm} />
          </Field>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-xs text-muted-foreground">{t("至少 8 位，建议混合大小写字母、数字和符号。")}</span>
          <Button type="submit" size="sm" loading={isSubmitting}>
            {t("修改密码")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- plan

function PlanCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [compare, setCompare] = React.useState(false);
  const usage = useQuery({ queryKey: ["overview", "30d"], queryFn: () => api.overview("30d"), staleTime: 5 * 60_000 });
  const sites = useQuery({ queryKey: ["sites", "picker"], queryFn: () => api.sites({ pageSize: 200 }), staleTime: 60_000 });
  const plan = me.plan;
  const used = usage.data?.totals.bytes ?? 0;
  const domains = sites.data?.items.reduce((a, s) => a + s.domains.length, 0) ?? 0;
  const trafficRatio = plan.trafficQuotaBytes ? used / plan.trafficQuotaBytes : 0;
  const domainRatio = plan.domainsQuota ? domains / plan.domainsQuota : 0;
  const tone = (r: number): "danger" | "warning" | "primary" => (r > 0.9 ? "danger" : r > 0.75 ? "warning" : "primary");
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(70%_100%_at_100%_0%,var(--primary-soft),transparent_70%)]" />
      <CardHeader className="relative">
        <CardDescription>{t("当前套餐")}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-lg">
          {plan.name}
          {plan.expiresAt ? <Badge variant="outline" className="font-normal text-muted-foreground">{t("{{date}} 到期", { date: formatDate(plan.expiresAt, locale) })}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="relative space-y-4">
        <Meter
          value={trafficRatio}
          tone={tone(trafficRatio)}
          label={
            <>
              <span>{t("本月流量")}</span>
              <span className="tabular">
                <span className="font-medium text-foreground">{usage.isPending ? "…" : formatBytes(used)}</span>
                {plan.trafficQuotaBytes ? ` / ${formatBytes(plan.trafficQuotaBytes, 0)}` : ` / ${t("不限")}`}
              </span>
            </>
          }
        />
        <Meter
          value={domainRatio}
          tone={tone(domainRatio)}
          label={
            <>
              <span>{t("域名数")}</span>
              <span className="tabular">
                <span className="font-medium text-foreground">{sites.isPending ? "…" : domains}</span>
                {plan.domainsQuota ? ` / ${plan.domainsQuota}` : ` / ${t("不限")}`}
              </span>
            </>
          }
        />
      </CardContent>
      <CardFooter className="relative">
        <Button variant="outline" size="sm" className="w-full" onClick={() => setCompare(true)}>
          {t("对比套餐与升级")}
          <ArrowUpRight />
        </Button>
      </CardFooter>
      <PlansDialog open={compare} onOpenChange={setCompare} current={plan.id} />
    </Card>
  );
}

function PlansDialog({ open, onOpenChange, current }: { open: boolean; onOpenChange: (o: boolean) => void; current: string }) {
  const { t } = useTranslation();
  const plans = useQuery({ queryKey: ["plans"], queryFn: api.plans, enabled: open, staleTime: 10 * 60_000 });
  const price = (p: Plan) =>
    p.priceMonthly == null ? t("联系销售") : p.priceMonthly === 0 ? t("免费") : `${p.currency === "CNY" ? "¥" : "$"}${p.priceMonthly.toLocaleString()}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("套餐对比")}</DialogTitle>
          <DialogDescription>{t("升级立即生效，按剩余天数折算差价。降级在当前周期结束后生效。")}</DialogDescription>
        </DialogHeader>
        {plans.error ? (
          <ErrorState error={plans.error} onRetry={() => void plans.refetch()} retryLabel={t("重试")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(plans.data ?? Array.from({ length: 4 }, () => null)).map((p, i) =>
              p ? (
                <div key={p.id} className={cn("relative flex flex-col rounded-xl border p-4", p.id === current ? "border-primary ring-1 ring-primary/30" : p.highlight && "bg-subtle/70")}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{p.name}</span>
                    {p.id === current ? <Badge variant="soft">{t("当前套餐")}</Badge> : p.highlight ? <Badge variant="secondary">{t("最受欢迎")}</Badge> : null}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tracking-tight tabular">{price(p)}</span>
                    {p.priceMonthly ? <span className="text-xs text-muted-foreground">/ {t("月")}</span> : null}
                  </div>
                  <div className="mt-3 space-y-1 border-y py-3 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("流量")}</span>
                      <span className="font-medium tabular">{p.trafficQuotaBytes ? `${formatBytes(p.trafficQuotaBytes, 0)}/${t("月")}` : t("按需")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("域名")}</span>
                      <span className="font-medium tabular">{p.domainsQuota ?? t("不限")}</span>
                    </div>
                  </div>
                  <ul className="mt-3 flex-1 space-y-1.5 text-[13px]">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                        {t(f)}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-4 w-full" size="sm" variant={p.id === current ? "outline" : p.highlight ? "default" : "outline"} disabled={p.id === current} asChild={p.id !== current}>
                    {p.id === current ? (
                      <span>{t("使用中")}</span>
                    ) : (
                      <a href={`mailto:sales@example.com?subject=${encodeURIComponent(`Hcdn ${p.name}`)}`}>{p.priceMonthly == null ? t("联系销售") : t("联系我们升级")}</a>
                    )}
                  </Button>
                </div>
              ) : (
                <Skeleton key={i} className="h-80 rounded-xl" />
              ),
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- activity

function activityIcon(a: ActivityItem) {
  const s = a.action;
  if (s.includes("登录")) return <LogIn />;
  if (s.includes("密码") || s.includes("密钥")) return <KeyRound />;
  if (s.includes("删除")) return <Trash2 />;
  if (s.includes("证书")) return <ShieldCheck />;
  if (s.includes("缓存")) return <Zap />;
  if (s.includes("网站")) return <Globe />;
  return <Settings2 />;
}

function ActivityCard() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const q = useQuery({ queryKey: ["activity"], queryFn: api.activity });
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t("最近活动")}</CardTitle>
        <CardDescription>{t("账号的登录与配置变更记录")}</CardDescription>
      </CardHeader>
      {q.error && !q.data ? (
        <ErrorState title={t("活动记录加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
      ) : q.isPending ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState compact icon={<Activity />} title={t("暂无活动")} />
      ) : (
        <ol className="max-h-[420px] divide-y overflow-y-auto scrollbar-thin">
          {q.data.map((a) => (
            <li key={a.id} className="flex gap-3 px-5 py-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-subtle text-muted-foreground [&_svg]:size-3.5">{activityIcon(a)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]" title={a.action}>
                  {a.action}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-mono">{a.ip}</span>
                  <span>·</span>
                  <span className="shrink-0" title={formatDateTime(a.time, locale)}>
                    {formatRelative(a.time, locale)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
