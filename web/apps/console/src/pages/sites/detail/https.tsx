import * as React from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowUpRight, Sparkles, Upload } from "lucide-react";
import type { Site, SiteHttps } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { SettingRow } from "@hcdn/ui/blocks/field";
import { SaveBar } from "@hcdn/ui/blocks/save-bar";
import { ErrorState } from "@hcdn/ui/blocks/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { RadioCard, RadioGroup } from "@hcdn/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Switch } from "@hcdn/ui/components/switch";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { formatDate } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { certExpiry, uncovered } from "@/lib/cert";
import { currentLocale } from "@/lib/i18n";
import { useSite } from "./layout";

export function SiteHttpsTab() {
  const { t } = useTranslation();
  const site = useSite();
  const q = useQuery({ queryKey: ["site-https", site.id], queryFn: () => api.https(site.id) });
  if (q.error && !q.data) return <ErrorState title={t("HTTPS 设置加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />;
  if (!q.data) return <SettingsSkeleton />;
  return <HttpsForm key={JSON.stringify(q.data)} site={site} initial={q.data} />;
}

export function SettingsSkeleton() {
  return (
    <Card>
      <CardContent className="divide-y">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between gap-6 py-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-72" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function HttpsForm({ site, initial }: { site: Site; initial: SiteHttps }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = React.useState<SiteHttps>(initial);
  const set = <K extends keyof SiteHttps>(k: K, value: SiteHttps[K]) => setV((s) => ({ ...s, [k]: value }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const certs = useQuery({ queryKey: ["certs", { all: true }], queryFn: () => api.certs({ pageSize: 200 }), enabled: v.enabled });
  const hasWildcard = site.domains.some((d) => d.startsWith("*."));
  const needsCert = v.enabled && !v.autoCert && v.certId == null;
  const selected = certs.data?.items.find((c) => c.id === v.certId);
  const missing = selected ? uncovered(selected, site.domains) : [];

  const mutation = useMutation({
    mutationFn: () => api.updateHttps(site.id, v),
    onSuccess: (res) => {
      qc.setQueryData(["site-https", site.id], res);
      qc.setQueryData<Site>(["site", site.id], (s) => (s ? { ...s, https: res } : s));
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["certs"] });
      toast.success(t("HTTPS 设置已保存"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const off = !v.enabled;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("证书")}</CardTitle>
          <CardDescription>{t("访客与边缘节点之间使用的 TLS 证书。")}</CardDescription>
        </CardHeader>
        <CardContent className="py-0">
          <SettingRow title={<label htmlFor="https-enabled">{t("启用 HTTPS")}</label>} description={t("允许访客通过 https:// 访问网站。")}>
            <Switch id="https-enabled" checked={v.enabled} onCheckedChange={(c) => set("enabled", c)} />
          </SettingRow>
          {v.enabled ? (
            <div className="space-y-4 border-t py-4">
              <RadioGroup
                value={v.autoCert ? "auto" : "custom"}
                onValueChange={(x) => setV((s) => ({ ...s, autoCert: x === "auto", certId: x === "auto" ? null : s.certId }))}
                className="grid-cols-1 md:grid-cols-2"
                aria-label={t("证书来源")}
              >
                <RadioCard value="auto" disabled={hasWildcard}>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" />
                    {t("自动申请免费证书")}
                  </span>
                  <span className="pr-6 text-[13px] text-muted-foreground">
                    {hasWildcard ? t("通配符域名需要 DNS 验证，不支持自动申请。") : t("Let's Encrypt 证书，CNAME 生效后自动签发，到期前 30 天自动续期。")}
                  </span>
                </RadioCard>
                <RadioCard value="custom">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Upload className="size-4 text-muted-foreground" />
                    {t("使用已有证书")}
                  </span>
                  <span className="pr-6 text-[13px] text-muted-foreground">{t("从证书管理中选择已上传或已签发的证书，例如 EV/OV 证书或通配符证书。")}</span>
                </RadioCard>
              </RadioGroup>
              {!v.autoCert ? (
                <div className="space-y-2 rounded-xl border bg-subtle/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium" htmlFor="cert-select">
                      {t("选择证书")}
                    </label>
                    <Link to="/certs" className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                      {t("管理证书")}
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </div>
                  <Select value={v.certId == null ? "" : String(v.certId)} onValueChange={(x) => set("certId", Number(x))}>
                    <SelectTrigger id="cert-select" className="w-full bg-background" aria-invalid={needsCert}>
                      <SelectValue placeholder={certs.isPending ? t("加载中…") : t("请选择证书")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(certs.data?.items ?? []).map((c) => {
                        const exp = certExpiry(c);
                        const miss = uncovered(c, site.domains).length;
                        return (
                          <SelectItem key={c.id} value={String(c.id)} disabled={exp.days < 0}>
                            <span className="font-mono text-[13px]">{c.domains.join(", ")}</span>
                            <span className={cn("ml-2 text-xs", exp.days < 0 ? "text-destructive-foreground" : "text-muted-foreground")}>
                              {exp.days < 0 ? t("已过期") : t("{{date}} 到期", { date: formatDate(c.notAfter, currentLocale()) })}
                              {miss > 0 && exp.days >= 0 ? ` · ${t("不完全匹配")}` : ""}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {needsCert ? <p className="text-[12.5px] font-medium text-destructive-foreground">{t("请选择证书，或改为自动申请")}</p> : null}
                  {missing.length > 0 ? (
                    <p className="flex gap-1.5 text-[12.5px] text-warning-foreground">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {t("该证书不包含 {{d}}，访问这些域名时浏览器会提示证书错误。", { d: missing.join("、") })}
                    </p>
                  ) : null}
                  {certs.data && certs.data.items.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">
                      {t("还没有证书。")}
                      <Link to="/certs" className="font-medium text-primary hover:underline">
                        {t("上传证书")}
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className={cn(off && "opacity-60")}>
        <CardHeader className="border-b">
          <CardTitle>{t("安全与协议")}</CardTitle>
          <CardDescription>{off ? t("启用 HTTPS 后可配置以下选项。") : t("修改会在 1 分钟内同步到全部边缘节点。")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y py-0">
          <SettingRow title={<label htmlFor="force">{t("强制 HTTPS")}</label>} description={t("把所有 HTTP 请求 301 跳转到 HTTPS。")}>
            <Switch id="force" disabled={off} checked={v.forceRedirect} onCheckedChange={(c) => set("forceRedirect", c)} />
          </SettingRow>
          <SettingRow
            title={<label htmlFor="hsts">HSTS</label>}
            description={
              <>
                {t("告诉浏览器在一年内只通过 HTTPS 访问。")}
                {v.hsts ? <span className="mt-1 block text-warning-foreground">{t("开启后即使关闭 HTTPS，已访问过的浏览器仍会强制使用 HTTPS，请确保证书长期有效。")}</span> : null}
              </>
            }
          >
            <Switch id="hsts" disabled={off} checked={v.hsts} onCheckedChange={(c) => set("hsts", c)} />
          </SettingRow>
          <SettingRow title={<label htmlFor="http2">HTTP/2</label>} description={t("多路复用连接，显著提升页面加载速度。建议保持开启。")}>
            <Switch id="http2" disabled={off} checked={v.http2} onCheckedChange={(c) => set("http2", c)} />
          </SettingRow>
          <SettingRow title={<label htmlFor="tls">{t("最低 TLS 版本")}</label>} description={t("低于该版本的客户端将无法建立连接。TLS 1.0/1.1 已不安全，仅在需要兼容老旧设备时选择。")}>
            <Select value={v.minTlsVersion} onValueChange={(x) => set("minTlsVersion", x as SiteHttps["minTlsVersion"])} disabled={off}>
              <SelectTrigger id="tls" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1.0">TLS 1.0</SelectItem>
                <SelectItem value="1.1">TLS 1.1</SelectItem>
                <SelectItem value="1.2">{t("TLS 1.2（推荐）")}</SelectItem>
                <SelectItem value="1.3">TLS 1.3</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      <SaveBar
        open={dirty}
        saving={mutation.isPending}
        onSave={() => (needsCert ? toast.error(t("请选择证书，或改为自动申请")) : mutation.mutate())}
        onReset={() => setV(initial)}
        message={t("有未保存的更改")}
        saveLabel={t("保存更改")}
        resetLabel={t("放弃")}
      />
    </div>
  );
}
