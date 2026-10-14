import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { ArrowLeft, MailCheck, CircleCheck, CircleAlert } from "lucide-react";
import { errorMessage } from "@hcdn/api/client";
import { Button } from "@hcdn/ui/components/button";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput, PasswordStrength } from "@hcdn/ui/components/password-input";
import { Field } from "@hcdn/ui/blocks/field";
import { EmptyState } from "@hcdn/ui/blocks/states";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { usePublicConfig } from "@/lib/auth";
import { AuthHeader } from "@/layouts/auth-layout";

const forgotSchema = z.object({ email: z.string().trim().email("请输入有效的邮箱地址") });

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const [sent, setSent] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });

  if (config.data && !config.data.passwordResetAvailable) {
    return (
      <EmptyState
        title={t("暂不支持自助找回密码")}
        description={t("请联系技术支持重置密码。")}
        action={
          <Button asChild variant="outline">
            <Link to="/login">{t("返回登录")}</Link>
          </Button>
        }
      />
    );
  }
  if (sent) {
    return (
      <EmptyState
        icon={<MailCheck />}
        title={t("邮件已发送")}
        description={t("如果 {{email}} 已注册，你将收到一封包含重置链接的邮件，链接 30 分钟内有效。", { email: sent })}
        action={
          <Button asChild variant="outline">
            <Link to="/login">{t("返回登录")}</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div>
      <AuthHeader title={t("找回密码")} subtitle={t("输入注册邮箱，我们会发送一封重置密码的邮件。")} />
      <form
        noValidate
        className="grid gap-5"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await api.forgotPassword(v.email);
            setSent(v.email);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}
      >
        <Field label={t("邮箱")} htmlFor="email" error={form.formState.errors.email?.message ? t(form.formState.errors.email.message) : undefined}>
          <Input id="email" type="email" autoComplete="email" autoFocus className="h-10" {...form.register("email")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          {t("发送重置邮件")}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/login">
            <ArrowLeft />
            {t("返回登录")}
          </Link>
        </Button>
      </form>
    </div>
  );
}

const resetSchema = z
  .object({ password: z.string().min(8, "密码至少 8 位"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "两次输入的密码不一致" });

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  if (!token) {
    return (
      <EmptyState
        icon={<CircleAlert />}
        title={t("链接无效")}
        description={t("重置链接缺少必要参数，请重新申请。")}
        action={
          <Button asChild variant="outline">
            <Link to="/forgot-password">{t("重新申请")}</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div>
      <AuthHeader title={t("设置新密码")} subtitle={t("新密码至少 8 位，建议包含大小写字母、数字和符号。")} />
      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            await api.resetPassword(token, v.password);
            toast.success(t("密码已重置，请使用新密码登录"));
            navigate("/login", { replace: true });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })}
      >
        <Field label={t("新密码")} htmlFor="password" error={errors.password?.message ? t(errors.password.message) : undefined}>
          <PasswordInput id="password" autoComplete="new-password" autoFocus className="h-10" {...form.register("password")} />
          <PasswordStrength value={form.watch("password")} />
        </Field>
        <Field label={t("确认新密码")} htmlFor="confirm" error={errors.confirm?.message ? t(errors.confirm.message) : undefined}>
          <PasswordInput id="confirm" autoComplete="new-password" className="h-10" {...form.register("confirm")} />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full" loading={isSubmitting}>
          {t("重置密码")}
        </Button>
      </form>
    </div>
  );
}

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = React.useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    if (!token) {
      setState("error");
      return;
    }
    api
      .verifyEmail(token)
      .then(() => setState("ok"))
      .catch((e: unknown) => {
        setState("error");
        setMessage(errorMessage(e));
      });
  }, [token]);
  if (state === "loading") return <EmptyState title={t("正在验证…")} />;
  return state === "ok" ? (
    <EmptyState
      icon={<CircleCheck />}
      title={t("邮箱验证成功")}
      description={t("现在可以登录并开始使用 Hcdn。")}
      action={
        <Button asChild>
          <Link to="/login">{t("去登录")}</Link>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<CircleAlert />}
      title={t("验证失败")}
      description={message || t("链接无效或已过期。")}
      action={
        <Button asChild variant="outline">
          <Link to="/login">{t("返回登录")}</Link>
        </Button>
      }
    />
  );
}
