import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, CircleAlert, Clock3, Info, RefreshCw } from "lucide-react";
import type { DnsCheck, Site } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { CopyButton } from "@hcdn/ui/blocks/status";
import { Button } from "@hcdn/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@hcdn/ui/components/tabs";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { hostRecord } from "@/lib/site";

/** DNS-record styled table: one CNAME row per domain, each cell copyable. */
export function DnsRecordTable({ domains, cname, checks }: { domains: string[]; cname: string; checks?: DnsCheck[] }) {
  const { t } = useTranslation();
  return (
    <>
    {/* Small screens: one card per record */}
    <ul className="space-y-2 sm:hidden">
      {domains.map((d) => {
        const { host } = hostRecord(d);
        const check = checks?.find((c) => c.domain === d);
        return (
          <li key={d} className="space-y-2 rounded-xl border p-3 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-muted-foreground">{d}</span>
              {checks ? <DnsCheckBadge check={check} /> : null}
            </div>
            <dl className="grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-1">
              <dt className="text-xs text-muted-foreground">{t("记录类型")}</dt>
              <dd>
                <span className="inline-flex rounded-md bg-primary-soft px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-primary-soft-foreground">CNAME</span>
              </dd>
              <dt className="text-xs text-muted-foreground">{t("主机记录")}</dt>
              <dd className="flex min-w-0 items-center gap-0.5">
                <span className="truncate font-mono font-medium">{host}</span>
                <CopyButton value={host} successText={t("已复制")} />
              </dd>
              <dt className="text-xs text-muted-foreground">{t("记录值")}</dt>
              <dd className="flex min-w-0 items-center gap-0.5">
                <span className="truncate font-mono font-medium">{cname}</span>
                <CopyButton value={cname} successText={t("已复制")} />
              </dd>
            </dl>
          </li>
        );
      })}
    </ul>
    <div className="hidden overflow-hidden rounded-xl border sm:block">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-[13px]">
          <thead className="bg-subtle/70 text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{t("记录类型")}</th>
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{t("主机记录")}</th>
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{t("记录值")}</th>
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">TTL</th>
              {checks ? <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{t("解析状态")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => {
              const { host, zone } = hostRecord(d);
              const check = checks?.find((c) => c.domain === d);
              return (
                <tr key={d} className="border-b last:border-0">
                  <td className="px-4 py-3 align-top">
                    <span className="mt-1 inline-flex rounded-md bg-primary-soft px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-primary-soft-foreground">CNAME</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-0.5">
                      <span className="font-mono font-medium">{host}</span>
                      <CopyButton value={host} successText={t("已复制")} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("域名")} <span className="font-mono">{d}</span>
                      {host === "@" ? null : <span className="hidden sm:inline">（{t("主域")} {zone}）</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-0.5">
                      <span className="font-mono font-medium whitespace-nowrap">{cname}</span>
                      <CopyButton value={cname} successText={t("已复制")} />
                    </div>
                  </td>
                  <td className="px-4 pt-[17px] pb-3 align-top whitespace-nowrap text-muted-foreground">{t("默认")}</td>
                  {checks ? (
                    <td className="px-4 pt-[17px] pb-3 align-top">
                      <DnsCheckBadge check={check} />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

export function DnsCheckBadge({ check }: { check?: DnsCheck }) {
  const { t } = useTranslation();
  if (!check) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        <Clock3 className="size-3.5" />
        {t("未检测")}
      </span>
    );
  }
  return check.ok ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-success-foreground">
      <CheckCircle2 className="size-3.5" />
      {t("已生效")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-warning-foreground" title={check.message}>
      <CircleAlert className="size-3.5" />
      {t("未生效")}
    </span>
  );
}

/** Per-domain DNS check results with the resolved values and reason. */
export function DnsCheckResults({ results }: { results: DnsCheck[] }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y rounded-xl border">
      {results.map((r) => (
        <li key={r.domain} className="flex items-start gap-3 px-4 py-3">
          {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <span className="font-mono text-[13px] font-medium">{r.domain}</span>
              <span className={cn("text-xs font-medium", r.ok ? "text-success-foreground" : "text-warning-foreground")}>{r.ok ? t("已指向 CNAME") : t("尚未生效")}</span>
            </div>
            <div className="mt-0.5 text-xs break-all text-muted-foreground">
              {r.ok
                ? t("解析到 {{v}}", { v: r.resolved.join("、") })
                : (r.message ?? (r.resolved.length ? t("解析到 {{v}}", { v: r.resolved.join("、") }) : t("未找到解析记录")))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "检测解析" button + results; updates the cached site afterwards. */
export function useDnsCheck(site: Pick<Site, "id"> | null | undefined) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.checkDns(site!.id),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["site", site!.id] });
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      const ok = res.results.filter((r) => r.ok).length;
      if (ok === res.results.length) toast.success(t("解析已生效，网站开始加速"));
      else toast.warning(t("{{ok}}/{{n}} 个域名已生效，DNS 变更通常需要几分钟到几小时", { ok, n: res.results.length }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function DnsCheckButton({ check, lastCheckedAt, size = "default" }: { check: ReturnType<typeof useDnsCheck>; lastCheckedAt?: number | null; size?: "sm" | "default" }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      {lastCheckedAt ? (
        <span className="hidden text-xs text-muted-foreground sm:inline">{t("上次检测 {{time}}", { time: formatRelative(lastCheckedAt, currentLocale()) })}</span>
      ) : null}
      <Button variant="outline" size={size} onClick={() => check.mutate()} loading={check.isPending}>
        {check.isPending ? null : <RefreshCw />}
        {check.isPending ? t("正在检测…") : t("检测解析")}
      </Button>
    </div>
  );
}

/** Step-by-step hints for the DNS providers our customers use most. */
export function DnsProviderTips({ cname, hasApex }: { cname: string; hasApex: boolean }) {
  const { t } = useTranslation();
  const code = (s: string) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{s}</code>;
  const Step = ({ children }: { children: React.ReactNode }) => <li className="pl-1 leading-relaxed">{children}</li>;
  return (
    <Tabs defaultValue="cloudflare" className="gap-3">
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="cloudflare">Cloudflare</TabsTrigger>
        <TabsTrigger value="aliyun">{t("阿里云")}</TabsTrigger>
        <TabsTrigger value="dnspod">DNSPod</TabsTrigger>
        <TabsTrigger value="other">{t("其他")}</TabsTrigger>
      </TabsList>
      <div className="rounded-xl border bg-subtle/60 p-4 text-[13px] text-muted-foreground">
        <TabsContent value="cloudflare">
          <ol className="list-decimal space-y-1.5 pl-4 marker:text-muted-foreground/70">
            <Step>{t("进入域名的 DNS → Records 页面，点击 Add record。")}</Step>
            <Step>
              {t("类型选择 CNAME，Name 填写上表的主机记录，Target 填写")} {code(cname)}
            </Step>
            <Step>
              <span className="font-medium text-foreground">{t("把 Proxy status 切换为「仅 DNS」（灰色云朵）。")}</span>
              {t("橙色云朵会让流量先经过 Cloudflare，导致无法接入和证书签发失败。")}
            </Step>
          </ol>
        </TabsContent>
        <TabsContent value="aliyun">
          <ol className="list-decimal space-y-1.5 pl-4 marker:text-muted-foreground/70">
            <Step>{t("登录阿里云控制台，进入「云解析 DNS」→ 选择域名 →「添加记录」。")}</Step>
            <Step>
              {t("记录类型选 CNAME，主机记录填上表的值，记录值填写")} {code(cname)}
            </Step>
            <Step>{t("解析线路选「默认」，TTL 保持 10 分钟即可。如已有同名的 A 记录，需先暂停或删除。")}</Step>
          </ol>
        </TabsContent>
        <TabsContent value="dnspod">
          <ol className="list-decimal space-y-1.5 pl-4 marker:text-muted-foreground/70">
            <Step>{t("登录 DNSPod 控制台，进入「我的域名」→ 选择域名 →「添加记录」。")}</Step>
            <Step>
              {t("记录类型选 CNAME，主机记录填上表的值，记录值填写")} {code(cname)}
            </Step>
            <Step>{t("线路类型选「默认」。同一主机记录的 CNAME 不能与 A、MX 等记录并存。")}</Step>
          </ol>
        </TabsContent>
        <TabsContent value="other">
          <p className="leading-relaxed">
            {t("在 DNS 服务商处为每个域名新增一条 CNAME 记录，指向")} {code(cname)}
            {t("。如果当前存在同名的 A/AAAA 记录，请先删除。DNS 变更通常在几分钟内生效，个别服务商最长需要 48 小时。")}
          </p>
        </TabsContent>
        {hasApex ? (
          <p className="mt-3 flex gap-2 border-t pt-3 leading-relaxed">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <span>{t("根域名（@）按 DNS 规范不能设置 CNAME。Cloudflare 会自动进行 CNAME 展平；阿里云、DNSPod 等请使用其提供的「CNAME 展平」功能，或改用 www 子域名。")}</span>
          </p>
        ) : null}
      </div>
    </Tabs>
  );
}
