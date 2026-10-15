import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import { Button } from "@hcdn/ui/components/button";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput } from "@hcdn/ui/components/password-input";
import { Turnstile, type TurnstileHandle } from "@hcdn/ui/components/turnstile";
import { Field } from "@hcdn/ui/blocks/field";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { safeNext, usePublicConfig } from "@/lib/auth";
import { AuthHeader } from "@/layouts/auth-layout";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名或邮箱"),
  password: z.string().min(1, "请输入密码"),
  otp: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const config = usePublicConfig();
  const [needOtp, setNeedOtp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [captchaError, setCaptchaError] = React.useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const turnstileRef = React.useRef<TurnstileHandle>(null);
  const siteKey = config.data?.turnstileSiteKey ?? "";
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { username: "", password: "", otp: "" } });

  async function onSubmit(values: FormValues) {
    setError(null);
    setCaptchaError(null);
    try {
      const me = await api.login({
        username: values.username,
        password: values.password,
        otp: needOtp ? values.otp : undefined,
        turnstileToken: turnstileToken ?? undefined,
      });
      qc.setQueryData(["me"], me);
      toast.success(t("欢迎回来，{{name}}", { name: me.fullname || me.username }));
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (e) {
      // Tokens are single-use: any failed submit needs a fresh one.
      turnstileRef.current?.reset();
      setTurnstileToken(null);
      if (e instanceof ApiError) {
        if (e.code === "otp_required") {
          setNeedOtp(true);
          return;
        }
        if (e.code === "rate_limited" || e.status === 429) {
          setError(t("尝试次数过多，请 {{n}} 秒后再试", { n: e.retryAfter ?? 60 }));
          return;
        }
        if (e.code === "invalid_credentials") {
          setError(t("用户名或密码不正确"));
          return;
        }
        if (e.code === "invalid_otp") {
          form.setError("otp", { message: t("验证码不正确") });
          return;
        }
        if (e.code === "captcha_failed") {
          setCaptchaError(t("人机验证失败，请重试"));
          return;
        }
        if (e.code === "captcha_unavailable") {
          setCaptchaError(t("人机验证服务暂不可用，请稍后重试"));
          return;
        }
        setError(e.message);
        return;
      }
      setError(t("登录失败，请稍后重试"));
    }
  }

  const { errors, isSubmitting } = form.formState;
  const needsCaptcha = Boolean(siteKey) && !turnstileToken;

  return (
    <div>
      <AuthHeader
        title={needOtp ? t("两步验证") : t("登录 Hcdn")}
        subtitle={
          needOtp ? (
            t("请输入身份验证器中的 6 位验证码")
          ) : config.data?.registrationOpen !== false ? (
            <>
              {t("还没有账号？")}{" "}
              <Link to="/register" className="font-medium text-primary hover:underline">
                {t("免费注册")}
              </Link>
            </>
          ) : null
        }
      />
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
                {...form.register("otp")}
              />
            </div>
          </Field>
        ) : (
          <>
            <Field label={t("用户名或邮箱")} htmlFor="username" error={errors.username?.message ? t(errors.username.message) : undefined}>
              <Input id="username" autoComplete="username" autoFocus className="h-10" {...form.register("username")} />
            </Field>
            <Field
              label={t("密码")}
              htmlFor="password"
              error={errors.password?.message ? t(errors.password.message) : undefined}
              aside={
                config.data?.passwordResetAvailable !== false ? (
                  <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
                    {t("忘记密码？")}
                  </Link>
                ) : null
              }
            >
              <PasswordInput id="password" autoComplete="current-password" className="h-10" {...form.register("password")} />
            </Field>
          </>
        )}
        {siteKey ? (
          <div className="grid gap-2">
            <Turnstile
              ref={turnstileRef}
              siteKey={siteKey}
              lang={i18n.language === "en" ? "en" : "zh"}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
            />
            {captchaError ? <p className="text-[12.5px] font-medium text-destructive-foreground">{captchaError}</p> : null}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-foreground">
            {error}
          </div>
        ) : null}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={needsCaptcha}>
          {needOtp ? t("验证并登录") : t("登录")}
          {!isSubmitting ? <ArrowRight /> : null}
        </Button>
        {needOtp ? (
          <Button type="button" variant="ghost" onClick={() => setNeedOtp(false)}>
            {t("返回")}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
