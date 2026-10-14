import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import type { Origin, Site } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { Field } from "@hcdn/ui/blocks/field";
import { SaveBar } from "@hcdn/ui/blocks/save-bar";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Input } from "@hcdn/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { TagInput } from "@hcdn/ui/components/tag-input";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { domainError, normalizeDomain, originHostError, portError } from "@/lib/validate";
import { DnsCheckButton, DnsCheckResults, DnsProviderTips, DnsRecordTable, useDnsCheck } from "@/components/dns";
import { useSite } from "./layout";

export function SiteDomainsTab() {
  const site = useSite();
  return (
    <div className="space-y-6">
      <DomainsCard site={site} />
      <OriginsCard key={`${site.id}:${JSON.stringify(site.origins)}:${site.originHost}`} site={site} />
    </div>
  );
}

function useSaveSite() {
  const qc = useQueryClient();
  return (site: Site) => {
    qc.setQueryData(["site", site.id], site);
    void qc.invalidateQueries({ queryKey: ["sites"] });
  };
}

function DomainsCard({ site }: { site: Site }) {
  const { t } = useTranslation();
  const save = useSaveSite();
  const check = useDnsCheck(site);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(site.domains);
  const invalid = draft.filter((d) => domainError(d));
  const mutation = useMutation({
    mutationFn: () => api.updateDomains(site.id, draft),
    onSuccess: (s) => {
      save(s);
      setEditing(false);
      toast.success(t("域名已更新"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pending = site.dnsChecks.length === 0 || site.dnsChecks.some((c) => !c.ok);
  const hasApex = site.domains.some((d) => d.split(".").length === 2);
  const checks = check.data?.results ?? site.dnsChecks;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t("域名")}</CardTitle>
        <CardDescription>{t("为每个域名添加 CNAME 记录指向下方的记录值，解析生效后流量即经由边缘节点。")}</CardDescription>
        <CardAction className="col-span-full row-start-3 mt-2 flex items-center gap-2 justify-self-start sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          {editing ? null : (
            <>
              <DnsCheckButton check={check} lastCheckedAt={site.dnsCheckedAt} size="sm" />
              <Button variant="outline" size="sm" onClick={() => { setDraft(site.domains); setEditing(true); }}>
                <Pencil />
                {t("编辑")}
              </Button>
            </>
          )}
        </CardAction>
      </CardHeader>
      {editing ? (
        <>
          <CardContent className="space-y-3">
            <Field
              label={t("域名")}
              htmlFor="edit-domains"
              description={t("新增的域名需要重新添加 CNAME 记录；移除域名后，该域名将不再经过加速。")}
              error={draft.length === 0 ? t("请至少保留一个域名") : invalid.length ? t("请修正格式不正确的域名") : undefined}
            >
              <TagInput
                id="edit-domains"
                value={draft}
                onChange={setDraft}
                validate={(d) => {
                  const e = domainError(d);
                  return e ? t(e) : null;
                }}
                normalize={normalizeDomain}
                placeholder="www.example.com"
                aria-invalid={draft.length === 0 || invalid.length > 0}
                removeLabel={(d) => t("移除 {{d}}", { d })}
              />
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={mutation.isPending}>
              {t("取消")}
            </Button>
            <Button size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={draft.length === 0 || invalid.length > 0 || draft.join() === site.domains.join()}>
              {t("保存域名")}
            </Button>
          </CardFooter>
        </>
      ) : (
        <CardContent className="space-y-4">
          <DnsRecordTable domains={site.domains} cname={site.cname} checks={checks} />
          {check.data && check.data.results.some((r) => !r.ok) ? <DnsCheckResults results={check.data.results.filter((r) => !r.ok)} /> : null}
          {pending ? <DnsProviderTips cname={site.cname} hasApex={hasApex} /> : null}
        </CardContent>
      )}
    </Card>
  );
}

type Draft = Origin & { key: number };
let keySeq = 1;
const DEFAULT_PORT = { http: 80, https: 443 } as const;

function OriginsCard({ site }: { site: Site }) {
  const { t } = useTranslation();
  const save = useSaveSite();
  const initial = React.useMemo(() => site.origins.map((o) => ({ ...o, key: keySeq++ })), [site.origins]);
  const [origins, setOrigins] = React.useState<Draft[]>(initial);
  const [originHost, setOriginHost] = React.useState(site.originHost);
  const [showErrors, setShowErrors] = React.useState(false);

  const strip = (list: Draft[]): Origin[] => list.map(({ key: _k, ...o }) => ({ ...o, host: o.host.trim() }));
  const dirty = JSON.stringify(strip(origins)) !== JSON.stringify(site.origins) || originHost.trim() !== site.originHost;
  const errors = origins.map((o) => ({ host: originHostError(o.host), port: portError(o.port) }));
  const hostErr = originHost.trim() && domainError(normalizeDomain(originHost)) ? t("回源 Host 需为域名") : null;
  const hasErrors = errors.some((e) => e.host || e.port) || !!hostErr || origins.length === 0;

  const mutation = useMutation({
    mutationFn: () => api.updateOrigins(site.id, strip(origins), originHost.trim() ? normalizeDomain(originHost) : ""),
    onSuccess: (s) => {
      save(s);
      toast.success(t("源站配置已保存"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function update(key: number, patch: Partial<Origin>) {
    setOrigins((list) =>
      list.map((o) => {
        if (o.key !== key) return o;
        const next = { ...o, ...patch };
        if (patch.protocol && o.port === DEFAULT_PORT[o.protocol]) next.port = DEFAULT_PORT[patch.protocol];
        return next;
      }),
    );
  }

  function submit() {
    if (hasErrors) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  }

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("源站")}</CardTitle>
          <CardDescription>{t("未命中缓存的请求会转发到这些地址。配置多个源站时按权重轮询，故障源站会被自动摘除。")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="hidden grid-cols-[7rem_1fr_6rem_5rem_2.25rem] gap-2 text-xs text-muted-foreground sm:grid" aria-hidden>
              <span>{t("协议")}</span>
              <span>{t("地址")}</span>
              <span>{t("端口")}</span>
              <span>{t("权重")}</span>
            </div>
            {origins.map((o, i) => {
              const e = showErrors ? errors[i] : null;
              return (
                <div key={o.key} className="grid grid-cols-[6rem_1fr_2.25rem] items-start gap-2 rounded-lg border p-2 sm:grid-cols-[7rem_1fr_6rem_5rem_2.25rem] sm:border-0 sm:p-0">
                  <Select value={o.protocol} onValueChange={(v) => update(o.key, { protocol: v as Origin["protocol"] })}>
                    <SelectTrigger className="w-full" aria-label={t("源站 {{n}} 协议", { n: i + 1 })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https">HTTPS</SelectItem>
                      <SelectItem value="http">HTTP</SelectItem>
                    </SelectContent>
                  </Select>
                  <div>
                    <Input
                      value={o.host}
                      onChange={(ev) => update(o.key, { host: ev.target.value })}
                      aria-label={t("源站 {{n}} 地址", { n: i + 1 })}
                      aria-invalid={!!e?.host}
                      placeholder={t("origin.example.com 或 IP 地址")}
                      className="font-mono text-[13px] placeholder:font-sans"
                    />
                    {e?.host ? <p className="mt-1.5 text-[12.5px] font-medium text-destructive-foreground">{t(e.host)}</p> : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground sm:order-last"
                    disabled={origins.length === 1}
                    onClick={() => setOrigins((list) => list.filter((x) => x.key !== o.key))}
                    aria-label={t("删除源站 {{n}}", { n: i + 1 })}
                  >
                    <Trash2 />
                  </Button>
                  <div className="col-span-1 col-start-2 grid grid-cols-2 gap-2 sm:col-span-2 sm:col-start-auto sm:grid-cols-[6rem_5rem]">
                    <div>
                      <Input
                        value={String(o.port)}
                        inputMode="numeric"
                        onChange={(ev) => update(o.key, { port: Number(ev.target.value.replace(/\D/g, "").slice(0, 5)) || 0 })}
                        aria-label={t("源站 {{n}} 端口", { n: i + 1 })}
                        aria-invalid={!!e?.port}
                        className="font-mono text-[13px] tabular"
                      />
                      {e?.port ? <p className="mt-1.5 text-[12.5px] font-medium text-destructive-foreground">{t(e.port)}</p> : null}
                    </div>
                    <Input
                      value={o.weight ?? ""}
                      inputMode="numeric"
                      placeholder="100"
                      onChange={(ev) => {
                        const n = Number(ev.target.value.replace(/\D/g, "").slice(0, 3));
                        update(o.key, { weight: n ? Math.min(100, n) : undefined });
                      }}
                      aria-label={t("源站 {{n}} 权重", { n: i + 1 })}
                      className="font-mono text-[13px] tabular"
                    />
                  </div>
                </div>
              );
            })}
            {origins.length < 10 ? (
              <Button
                variant="outline"
                size="sm"
                className="w-fit border-dashed"
                onClick={() => setOrigins((list) => [...list, { key: keySeq++, protocol: list[0]?.protocol ?? "https", host: "", port: DEFAULT_PORT[list[0]?.protocol ?? "https"] }])}
              >
                <Plus />
                {t("添加源站")}
              </Button>
            ) : null}
          </div>

          <Field
            label={t("回源 Host")}
            htmlFor="origin-host"
            error={showErrors && hostErr ? hostErr : undefined}
            description={t("请求源站时使用的 Host 头。留空则使用访客访问的域名；源站按域名区分站点（如对象存储、虚拟主机）时需要填写。")}
          >
            <Input id="origin-host" value={originHost} onChange={(e) => setOriginHost(e.target.value)} placeholder={t("跟随访问域名")} className="max-w-md font-mono text-[13px] placeholder:font-sans" />
          </Field>

          {site.status === "error" ? (
            <div className="flex gap-2.5 rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {t("边缘节点最近无法连接源站。请确认地址与端口正确，且防火墙放行了边缘节点的 IP。")}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <SaveBar
        open={dirty}
        saving={mutation.isPending}
        onSave={submit}
        onReset={() => {
          setOrigins(site.origins.map((o) => ({ ...o, key: keySeq++ })));
          setOriginHost(site.originHost);
          setShowErrors(false);
        }}
        message={t("源站配置有未保存的更改")}
        saveLabel={t("保存更改")}
        resetLabel={t("放弃")}
      />
    </>
  );
}
