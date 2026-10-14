import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Info, ShieldAlert } from "lucide-react";
import type { SystemSettings } from "@hcdn/api/types";
import { PageHeader, Section } from "@hcdn/ui/blocks/page-header";
import { ErrorState } from "@hcdn/ui/blocks/states";
import { SettingRow } from "@hcdn/ui/blocks/field";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { Button } from "@hcdn/ui/components/button";
import { Input } from "@hcdn/ui/components/input";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Switch } from "@hcdn/ui/components/switch";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { toastError } from "@/lib/hooks";
import { ClusterSelect } from "@/components/cluster-select";
import { IpListEditor } from "@/components/ip-list-editor";

type Draft = Pick<SystemSettings, "productName" | "consoleUrl" | "registration" | "adminIpAllowlist">;

function toDraft(s: SystemSettings): Draft {
  return { productName: s.productName, consoleUrl: s.consoleUrl, registration: { ...s.registration }, adminIpAllowlist: [...s.adminIpAllowlist] };
}

function validate(d: Draft): Partial<Record<"productName" | "consoleUrl", string>> {
  const e: Partial<Record<"productName" | "consoleUrl", string>> = {};
  if (!d.productName.trim()) e.productName = "请输入产品名称";
  else if (d.productName.length > 40) e.productName = "最多 40 个字符";
  try {
    const u = new URL(d.consoleUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") e.consoleUrl = "请输入以 https:// 开头的地址";
    else if (u.pathname !== "/" || u.search || u.hash) e.consoleUrl = "只填写协议和域名，不要包含路径";
  } catch {
    e.consoleUrl = "请输入以 https:// 开头的地址";
  }
  return e;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("系统设置")} description={t("影响整个平台的配置。修改会记录到审计日志。")} />
      {q.isPending ? (
        <div className="space-y-8">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("设置加载失败")} />
      ) : (
        <SettingsForm settings={q.data} />
      )}
    </div>
  );
}

function SettingsForm({ settings }: { settings: SystemSettings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(settings));
  const [showErrors, setShowErrors] = React.useState(false);
  const base = React.useMemo(() => toDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const errors = validate(draft);
  const invalid = Object.keys(errors).length > 0;

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api.updateSettings({ ...draft, productName: draft.productName.trim(), consoleUrl: draft.consoleUrl.trim().replace(/\/$/, "") }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      setDraft(toDraft(s));
      setShowErrors(false);
      toast.success(t("设置已保存"));
    },
    onError: (e) => toastError(e, "保存失败"),
  });

  function onSave() {
    if (invalid) {
      setShowErrors(true);
      return;
    }
    save.mutate();
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const patchReg = (p: Partial<Draft["registration"]>) => setDraft((d) => ({ ...d, registration: { ...d.registration, ...p } }));
  const err = (k: keyof typeof errors) => (showErrors && errors[k] ? t(errors[k]!) : null);

  return (
    <div className="space-y-8 pb-24">
      <Section title={t("基本信息")} description={t("显示在控制台、邮件和页面标题中")}>
        <Card>
          <SettingRow title={t("产品名称")} description={t("控制台左上角与邮件中显示的品牌名")}>
            <Input value={draft.productName} onChange={(e) => patch({ productName: e.target.value })} className="w-full sm:w-64" aria-invalid={!!err("productName")} />
            <FieldError msg={err("productName")} />
          </SettingRow>
          <SettingRow title={t("控制台地址")} description={t("用户访问控制台的地址，用于邮件中的链接")}>
            <Input
              value={draft.consoleUrl}
              onChange={(e) => patch({ consoleUrl: e.target.value })}
              placeholder="https://console.example.com"
              className="w-full font-mono text-[13px] sm:w-80"
              spellCheck={false}
              aria-invalid={!!err("consoleUrl")}
            />
            <FieldError msg={err("consoleUrl")} />
          </SettingRow>
        </Card>
      </Section>

      <Section title={t("注册")} description={t("控制台的自助注册策略")}>
        <Card>
          <SettingRow className="flex-row items-center gap-4" title={t("开放注册")} description={t("关闭后，只能由管理员在「用户」中创建账号")}>
            <Switch checked={draft.registration.open} onCheckedChange={(v) => patchReg({ open: v })} aria-label={t("开放注册")} />
          </SettingRow>
          <SettingRow
            className="flex-row items-center gap-4"
            title={t("要求验证邮箱")}
            description={
              settings.smtp.configured ? t("新用户需点击验证邮件中的链接后才能登录") : t("需要先配置 SMTP 才能发送验证邮件")
            }
          >
            <Switch
              checked={draft.registration.requireEmailVerification}
              onCheckedChange={(v) => patchReg({ requireEmailVerification: v })}
              disabled={!settings.smtp.configured || !draft.registration.open}
              aria-label={t("要求验证邮箱")}
            />
          </SettingRow>
          <SettingRow title={t("默认集群")} description={t("新注册用户的网站部署到该集群")}>
            <ClusterSelect className="w-full sm:w-56" value={String(draft.registration.defaultClusterId)} onChange={(v) => patchReg({ defaultClusterId: Number(v) })} />
          </SettingRow>
        </Card>
      </Section>

      <Section title={t("安全")} description={t("限制管理后台的访问来源")}>
        <Card>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t("管理后台 IP 白名单")}</div>
              <div className="text-[13px] leading-relaxed text-muted-foreground">
                {t("仅允许列表中的 IP 或网段访问管理后台（含登录页）。支持 IPv4、IPv6 与 CIDR，可一次粘贴多行。")}
              </div>
            </div>
            <IpListEditor
              value={draft.adminIpAllowlist}
              onChange={(v) => patch({ adminIpAllowlist: v })}
              emptyText={
                <span className="flex items-center gap-2">
                  <Info className="size-4 shrink-0" />
                  {t("未设置白名单：任何 IP 都可以访问管理后台登录页。")}
                </span>
              }
            />
            {JSON.stringify(draft.adminIpAllowlist) !== JSON.stringify(base.adminIpAllowlist) && draft.adminIpAllowlist.length > 0 ? (
              <div className="flex gap-2.5 rounded-lg border border-warning/35 bg-warning-soft px-3.5 py-3 text-[13px] text-warning-foreground">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>{t("保存前请确认列表包含你当前的出口 IP，否则保存后你将无法再访问管理后台。")}</span>
              </div>
            ) : null}
          </div>
        </Card>
      </Section>

      <Section title={t("邮件")} description={t("用于注册验证、找回密码与告警通知")}>
        <Card>
          <SettingRow className="flex-row items-center gap-4" title="SMTP" description={t("SMTP 凭据保存在服务端配置文件中，此处只读。")}>
            {settings.smtp.configured ? <StatusBadge tone="success">{t("已配置")}</StatusBadge> : <StatusBadge tone="warning">{t("未配置")}</StatusBadge>}
          </SettingRow>
          {settings.smtp.configured ? (
            <dl className="grid gap-x-8 gap-y-3 py-4 text-[13px] sm:grid-cols-2">
              <ReadOnly label={t("服务器")} value={`${settings.smtp.host}:${settings.smtp.port}`} />
              <ReadOnly label={t("用户名")} value={settings.smtp.username} />
              <ReadOnly label={t("发件人")} value={settings.smtp.from} className="sm:col-span-2" />
            </dl>
          ) : null}
        </Card>
      </Section>

      <SaveBar dirty={dirty} saving={save.isPending} invalid={showErrors && invalid} onDiscard={() => { setDraft(base); setShowErrors(false); }} onSave={onSave} />
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="divide-y rounded-xl border bg-card px-5 shadow-xs">{children}</div>;
}

function FieldError({ msg }: { msg: string | null }) {
  return msg ? <p className="mt-1.5 text-[12.5px] font-medium text-destructive-foreground sm:text-right">{msg}</p> : null;
}

function ReadOnly({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[13px]">{value || "—"}</dd>
    </div>
  );
}

function SaveBar({ dirty, saving, invalid, onDiscard, onSave }: { dirty: boolean; saving: boolean; invalid: boolean; onDiscard: () => void; onSave: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "pointer-events-none sticky bottom-4 z-20 transition-all duration-200",
        dirty ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
      aria-hidden={!dirty}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-popover/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <span className="relative flex size-2">
          <span className={cn("absolute inset-0 rounded-full", invalid ? "bg-destructive" : "bg-warning")} />
        </span>
        <span className="flex-1 text-[13px] font-medium">{invalid ? t("请先修正标红的字段") : t("有未保存的更改")}</span>
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>
          {t("放弃")}
        </Button>
        <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty} tabIndex={dirty ? 0 : -1}>
          {t("保存更改")}
        </Button>
      </div>
    </div>
  );
}
