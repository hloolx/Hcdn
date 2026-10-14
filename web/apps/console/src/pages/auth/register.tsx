import * as React from "react";
import { Link, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import { Button } from "@hcdn/ui/components/button";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput, PasswordStrength } from "@hcdn/ui/components/password-input";
import { Field } from "@hcdn/ui/blocks/field";
import { EmptyState } from "@hcdn/ui/blocks/states";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { usePublicConfig } from "@/lib/auth";
import { AuthHeader } from "@/layouts/auth-layout";

const schema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "用户名至少 3 个字符")
      .max(32, "用户名最多 32 个字符")
      .regex(/^[A-Za-z0-9_.-]+$/, "只能包含字母、数字、下划线、点和连字符"),
    email: z.string().trim().email("请输入有效的邮箱地址"),
    password: z.string().min(8, "密码至少 8 位").max(128, "密码过长"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "两次输入的密码不一致" });
type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = usePublicConfig();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", email: "", password: "", confirm: "" },
  });
  const password = form.watch("password");
  const { errors, isSubmitting } = form.formState;
  const msg = (m?: string) => (m ? t(m) : undefined);

  async function onSubmit(v: FormValues) {
    setError(null);
    try {
      const res = await api.register({ username: v.username, email: v.email, password: v.password });
      if (res.pendingVerification || !res.me) {
        setPending(v.email);
        return;
      }
      qc.setQueryData(["me"], res.me);
      toast.success(t("注册成功，欢迎使用 Hcdn"));
      navigate("/sites/new", { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [field, message] of Object.entries(e.fields)) {
          if (field in v) form.setError(field as keyof FormValues, { message });
        }
        if (Object.keys(e.fields).length === 0) setError(e.message);
        return;
      }
      setError(t("注册失败，请稍后重试"));
    }
  }

  if (config.data && !config.data.registrationOpen) {
    return (
      <EmptyState
        title={t("暂未开放注册")}
        description={t("如需开通账号，请联系我们的销售或技术支持。")}
        action={
          <Button asChild variant="outline">
            <Link to="/login">{t("返回登录")}</Link>
          </Button>
        }
      />
    );
  }

  if (pending) {
    return (
      <EmptyState
        icon={<MailCheck />}
        title={t("请查收验证邮件")}
        description={t("我们已向 {{email}} 发送了一封验证邮件，点击邮件中的链接即可完成注册。", { email: pending })}
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
      <AuthHeader
        title={t("创建账号")}
        subtitle={
          <>
            {t("已有账号？")}{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              {t("直接登录")}
            </Link>
          </>
        }
      />
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <Field label={t("用户名")} htmlFor="username" error={msg(errors.username?.message)}>
          <Input id="username" autoComplete="username" autoFocus className="h-10" {...form.register("username")} />
        </Field>
        <Field label={t("邮箱")} htmlFor="email" error={msg(errors.email?.message)}>
          <Input id="email" type="email" autoComplete="email" className="h-10" {...form.register("email")} />
        </Field>
        <Field label={t("密码")} htmlFor="password" error={msg(errors.password?.message)}>
          <PasswordInput id="password" autoComplete="new-password" className="h-10" {...form.register("password")} />
          <PasswordStrength value={password} />
        </Field>
        <Field label={t("确认密码")} htmlFor="confirm" error={msg(errors.confirm?.message)}>
          <PasswordInput id="confirm" autoComplete="new-password" className="h-10" {...form.register("confirm")} />
        </Field>
        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-foreground">
            {error}
          </div>
        ) : null}
        <Button type="submit" size="lg" className="mt-1 w-full" loading={isSubmitting}>
          {t("创建账号")}
        </Button>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {t("注册即表示你同意我们的服务条款与隐私政策。")}
        </p>
      </form>
    </div>
  );
}
