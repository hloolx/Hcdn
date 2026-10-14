import * as React from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import { LogoMark } from "@hcdn/ui/blocks/logo";
import { Field } from "@hcdn/ui/blocks/field";
import { Button } from "@hcdn/ui/components/button";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput } from "@hcdn/ui/components/password-input";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/auth";
import { AdminBadge } from "@/components/brand";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
  otp: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

function formatWait(seconds: number, t: (k: string, o?: Record<string, unknown>) => string) {
  if (seconds >= 60) return t("{{n}} 分钟", { n: Math.ceil(seconds / 60) });
  return t("{{n}} 秒", { n: seconds });
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [needOtp, setNeedOtp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lockedFor, setLockedFor] = React.useState<number | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { username: "", password: "", otp: "" } });

  // Count the lockout down so the operator knows when to try again.
  React.useEffect(() => {
    if (lockedFor == null) return;
    if (lockedFor <= 0) {
      setLockedFor(null);
      return;
    }
    const id = window.setTimeout(() => setLockedFor((v) => (v == null ? null : v - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [lockedFor]);

  async function onSubmit(values: FormValues) {
    setError(null);
    if (needOtp && !/^\d{6}$/.test(values.otp ?? "")) {
      form.setError("otp", { message: "请输入 6 位数字验证码" });
      return;
    }
    try {
      const me = await api.login({ username: values.username, password: values.password, otp: needOtp ? values.otp : undefined });
      qc.setQueryData(["me"], me);
      toast.success(t("欢迎回来，{{name}}", { name: me.fullname || me.username }));
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "otp_required") {
          setNeedOtp(true);
          form.setValue("otp", "");
          return;
        }
        if (e.code === "rate_limited" || e.status === 429) {
          setLockedFor(e.retryAfter ?? 900);
          return;
        }
        if (e.code === "invalid_credentials") {
          setError(t("用户名或密码不正确"));
          return;
        }
        if (e.code === "invalid_otp") {
          form.setError("otp", { message: "验证码不正确" });
          return;
        }
        setError(t(e.message));
        return;
      }
      setError(t("登录失败，请稍后重试"));
    }
  }

  const { errors, isSubmitting } = form.formState;
  const locked = lockedFor != null && lockedFor > 0;

  return (
    <div className="rounded-2xl border bg-card p-7 shadow-lg sm:p-8">
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="relative">
          <div className="absolute inset-0 -m-2 rounded-2xl bg-primary/15 blur-lg" />
          <LogoMark className="relative size-11" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{needOtp ? t("两步验证") : t("Hcdn 管理后台")}</h1>
          {needOtp ? null : <AdminBadge />}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {needOtp ? t("请输入身份验证器中的 6 位验证码") : t("使用管理员账号登录")}
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
        {needOtp ? (
          <Field label={t("验证码")} htmlFor="otp" error={errors.otp?.message ? t(errors.otp.message) : undefined}>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                placeholder="000000"
                className="h-11 pl-9 text-center font-mono text-lg tracking-[0.5em]"
                aria-invalid={!!errors.otp}
                {...form.register("otp")}
              />
            </div>
          </Field>
        ) : (
          <>
            <Field label={t("用户名")} htmlFor="username" error={errors.username?.message ? t(errors.username.message) : undefined}>
              <Input id="username" autoComplete="username" autoFocus className="h-10" aria-invalid={!!errors.username} {...form.register("username")} />
            </Field>
            <Field label={t("密码")} htmlFor="password" error={errors.password?.message ? t(errors.password.message) : undefined}>
              <PasswordInput id="password" autoComplete="current-password" className="h-10" aria-invalid={!!errors.password} {...form.register("password")} />
            </Field>
          </>
        )}

        {locked ? (
          <div role="alert" className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] text-warning-foreground">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{t("登录已被暂时锁定")}</div>
              <div className="mt-0.5 opacity-90">
                {t("失败次数过多，请在 {{time}}后重试。如非本人操作，请检查审计日志。", { time: formatWait(lockedFor!, t) })}
              </div>
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-foreground">
            {error}
          </div>
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={locked}>
          {needOtp ? t("验证并登录") : t("登录")}
          {!isSubmitting ? <ArrowRight /> : null}
        </Button>
        {needOtp ? (
          <Button
            type="button"
            variant="ghost"
            className="-mt-2"
            onClick={() => {
              setNeedOtp(false);
              form.clearErrors("otp");
            }}
          >
            <ArrowLeft />
            {t("返回")}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
