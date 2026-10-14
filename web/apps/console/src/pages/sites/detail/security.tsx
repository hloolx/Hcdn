import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleAlert, Eye, Info, ShieldBan } from "lucide-react";
import type { SecuritySettings } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { SettingRow } from "@hcdn/ui/blocks/field";
import { SaveBar } from "@hcdn/ui/blocks/save-bar";
import { ErrorState } from "@hcdn/ui/blocks/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Input } from "@hcdn/ui/components/input";
import { RadioCard, RadioGroup } from "@hcdn/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Switch } from "@hcdn/ui/components/switch";
import { Textarea } from "@hcdn/ui/components/textarea";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { ipOrCidrError, lines } from "@/lib/validate";
import { CountryPicker } from "@/components/country-picker";
import { SettingsSkeleton } from "./https";
import { useSite } from "./layout";

export function SiteSecurityTab() {
  const { t } = useTranslation();
  const site = useSite();
  const q = useQuery({ queryKey: ["site-security", site.id], queryFn: () => api.security(site.id) });
  if (q.error && !q.data) return <ErrorState title={t("安全设置加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />;
  if (!q.data) return <SettingsSkeleton />;
  return <SecurityForm key={JSON.stringify(q.data)} siteId={site.id} initial={q.data} />;
}

const PERIODS = [1, 10, 60, 300, 3600];
const BLOCKS = [60, 300, 600, 1800, 3600, 86400];

function duration(seconds: number, t: (k: string, o?: Record<string, unknown>) => string) {
  if (seconds % 86400 === 0) return t("{{n}} 天", { n: seconds / 86400 });
  if (seconds % 3600 === 0) return t("{{n}} 小时", { n: seconds / 3600 });
  if (seconds % 60 === 0) return t("{{n}} 分钟", { n: seconds / 60 });
  return t("{{n}} 秒", { n: seconds });
}

function SecurityForm({ siteId, initial }: { siteId: number; initial: SecuritySettings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = React.useState(initial);
  const [allowText, setAllowText] = React.useState(initial.ipAllow.join("\n"));
  const [denyText, setDenyText] = React.useState(initial.ipDeny.join("\n"));
  const allow = lines(allowText);
  const deny = lines(denyText);
  const badAllow = allow.filter((l) => ipOrCidrError(l));
  const badDeny = deny.filter((l) => ipOrCidrError(l));
  const both = allow.filter((ip) => deny.includes(ip));
  const next: SecuritySettings = { ...v, ipAllow: allow, ipDeny: deny };
  const dirty = JSON.stringify(next) !== JSON.stringify(initial);
  const rl = v.rateLimit;
  const rlError = rl.enabled && (!rl.requests || rl.requests < 1 || rl.requests > 1_000_000) ? t("请求数范围 1–1,000,000") : null;

  const mutation = useMutation({
    mutationFn: () => api.updateSecurity(siteId, next),
    onSuccess: (res) => {
      qc.setQueryData(["site-security", siteId], res);
      toast.success(t("安全设置已保存"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function save() {
    if (badAllow.length || badDeny.length) return toast.error(t("IP 名单中有 {{n}} 行格式不正确", { n: badAllow.length + badDeny.length }));
    if (rlError) return toast.error(rlError);
    mutation.mutate();
  }

  const setRl = (patch: Partial<SecuritySettings["rateLimit"]>) => setV((s) => ({ ...s, rateLimit: { ...s.rateLimit, ...patch } }));

  return (
    <div className="space-y-6">
      {/* WAF */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("Web 应用防火墙（WAF）")}</CardTitle>
          <CardDescription>{t("识别并拦截 SQL 注入、XSS、路径穿越、恶意扫描等常见攻击。")}</CardDescription>
        </CardHeader>
        <CardContent className="py-0">
          <SettingRow title={<label htmlFor="waf">{t("启用 WAF")}</label>} description={t("规则库由我们持续更新，无需手动维护。")}>
            <Switch id="waf" checked={v.waf.enabled} onCheckedChange={(c) => setV((s) => ({ ...s, waf: { ...s.waf, enabled: c } }))} />
          </SettingRow>
          {v.waf.enabled ? (
            <div className="border-t py-4">
              <RadioGroup value={v.waf.mode} onValueChange={(m) => setV((s) => ({ ...s, waf: { ...s.waf, mode: m as "block" | "log" } }))} className="grid-cols-1 md:grid-cols-2" aria-label={t("WAF 模式")}>
                <RadioCard value="block">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <ShieldBan className="size-4 text-destructive" />
                    {t("拦截模式")}
                  </span>
                  <span className="pr-6 text-[13px] text-muted-foreground">{t("命中规则的请求直接返回 403，并记录到访问日志。")}</span>
                </RadioCard>
                <RadioCard value="log">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Eye className="size-4 text-info" />
                    {t("仅记录")}
                  </span>
                  <span className="pr-6 text-[13px] text-muted-foreground">{t("只记录不拦截，适合上线初期观察是否有误报。")}</span>
                </RadioCard>
              </RadioGroup>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* IP lists */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("IP 访问控制")}</CardTitle>
          <CardDescription>{t("每行一个 IPv4/IPv6 地址或 CIDR 网段。允许名单中的 IP 跳过 WAF 与频率限制；拒绝名单中的 IP 直接返回 403。")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <IpListEditor id="ip-allow" label={t("允许名单")} value={allowText} onChange={setAllowText} entries={allow} invalid={badAllow} placeholder={"198.51.100.0/24\n203.0.113.10"} />
          <IpListEditor id="ip-deny" label={t("拒绝名单")} value={denyText} onChange={setDenyText} entries={deny} invalid={badDeny} placeholder={"203.0.113.7\n2001:db8:dead::/48"} />
          {both.length > 0 ? (
            <p className="flex gap-1.5 text-[12.5px] text-warning-foreground md:col-span-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t("{{ips}} 同时出现在两个名单中，允许名单优先。", { ips: both.join("、") })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Regions */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("地区封禁")}</CardTitle>
          <CardDescription>{t("来自所选国家/地区的访问将返回 403。按 IP 归属地判断，代理与 VPN 可能绕过。")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CountryPicker id="regions" value={v.blockedCountries} onChange={(c) => setV((s) => ({ ...s, blockedCountries: c }))} />
        </CardContent>
      </Card>

      {/* Rate limit */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("频率限制")}</CardTitle>
          <CardDescription>{t("限制单个 IP 的请求速率，缓解 CC 攻击与恶意爬虫。")}</CardDescription>
        </CardHeader>
        <CardContent className="py-0">
          <SettingRow title={<label htmlFor="rl">{t("启用频率限制")}</label>} description={t("超出限制的 IP 会在封禁期内收到 429 响应。")}>
            <Switch id="rl" checked={rl.enabled} onCheckedChange={(c) => setRl({ enabled: c })} />
          </SettingRow>
          <div className={cn("space-y-4 border-t py-4", !rl.enabled && "pointer-events-none opacity-50")} aria-disabled={!rl.enabled}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <label htmlFor="rl-period" className="text-sm font-medium">{t("统计周期")}</label>
                <Select value={String(rl.periodSeconds)} onValueChange={(x) => setRl({ periodSeconds: Number(x) })} disabled={!rl.enabled}>
                  <SelectTrigger id="rl-period" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIODS.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {duration(p, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label htmlFor="rl-requests" className="text-sm font-medium">{t("最多请求数")}</label>
                <Input
                  id="rl-requests"
                  inputMode="numeric"
                  value={rl.requests || ""}
                  onChange={(e) => setRl({ requests: Number(e.target.value.replace(/\D/g, "").slice(0, 7)) })}
                  aria-invalid={!!rlError}
                  className="tabular"
                  disabled={!rl.enabled}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="rl-block" className="text-sm font-medium">{t("封禁时长")}</label>
                <Select value={String(rl.blockSeconds)} onValueChange={(x) => setRl({ blockSeconds: Number(x) })} disabled={!rl.enabled}>
                  <SelectTrigger id="rl-block" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOCKS.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {duration(p, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {rlError ? <p className="text-[12.5px] font-medium text-destructive-foreground">{rlError}</p> : null}
            <div className="rounded-lg border bg-subtle/70 px-3.5 py-2.5 text-[13px]">
              <span className="text-muted-foreground">{t("规则说明：")}</span>
              {t("每个 IP 每 {{period}}最多 {{n}} 次请求，超出后封禁 {{block}}。", {
                period: rl.periodSeconds < 3600 ? t("{{n}} 秒", { n: rl.periodSeconds }) : duration(rl.periodSeconds, t),
                n: (rl.requests || 0).toLocaleString(),
                block: duration(rl.blockSeconds, t),
              })}
              {rl.requests && rl.periodSeconds ? (
                <span className="text-muted-foreground"> {t("（约 {{r}} 次/秒）", { r: +(rl.requests / rl.periodSeconds).toFixed(2) })}</span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <SaveBar open={dirty} saving={mutation.isPending} onSave={save} onReset={() => { setV(initial); setAllowText(initial.ipAllow.join("\n")); setDenyText(initial.ipDeny.join("\n")); }} message={t("安全设置有未保存的更改")} saveLabel={t("保存更改")} resetLabel={t("放弃")} />
    </div>
  );
}

function IpListEditor({ id, label, value, onChange, entries, invalid, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; entries: string[]; invalid: string[]; placeholder: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid content-start gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <span className="text-xs text-muted-foreground tabular">
          {t("{{n}} 条", { n: entries.length })}
          {invalid.length ? <span className="text-destructive-foreground"> · {t("{{n}} 条无效", { n: invalid.length })}</span> : null}
        </span>
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        spellCheck={false}
        aria-invalid={invalid.length > 0}
        aria-describedby={invalid.length ? `${id}-err` : undefined}
        className="font-mono text-[13px] leading-6 placeholder:text-muted-foreground/60"
      />
      {invalid.length ? (
        <div id={`${id}-err`} className="flex gap-1.5 text-[12.5px] text-destructive-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-all">
            {invalid.slice(0, 3).map((x, i) => (
              <React.Fragment key={x}>
                {i ? "、" : ""}
                <span className="font-mono">{x}</span>
              </React.Fragment>
            ))}
            {invalid.length > 3 ? t(" 等 {{n}} 行", { n: invalid.length }) : ""} {t("不是有效的 IP 或 CIDR")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
