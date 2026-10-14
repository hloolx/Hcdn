import * as React from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Gauge, Layers, Lock, Plus, ServerCog, Trash2, Zap, ZapOff } from "lucide-react";
import type { CreateSiteRequest, Origin, Site } from "@hcdn/api/types";
import { ApiError, errorMessage } from "@hcdn/api/client";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Stepper } from "@hcdn/ui/blocks/stepper";
import { Field, SettingRow } from "@hcdn/ui/blocks/field";
import { Button } from "@hcdn/ui/components/button";
import { Card } from "@hcdn/ui/components/card";
import { Input } from "@hcdn/ui/components/input";
import { RadioCard, RadioGroup } from "@hcdn/ui/components/radio-group";
import { Switch } from "@hcdn/ui/components/switch";
import { TagInput } from "@hcdn/ui/components/tag-input";
import { Badge } from "@hcdn/ui/components/badge";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { domainError, normalizeDomain, originHostError, portError } from "@/lib/validate";
import { DnsCheckButton, DnsCheckResults, DnsProviderTips, DnsRecordTable, useDnsCheck } from "@/components/dns";

type Proto = Origin["protocol"];
interface OriginDraft {
  key: number;
  host: string;
  port: string;
}

const DEFAULT_PORT: Record<Proto, number> = { http: 80, https: 443 };
let originKey = 1;

export function NewSitePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [step, setStep] = React.useState(0);
  const [showErrors, setShowErrors] = React.useState(false);

  const [domains, setDomains] = React.useState<string[]>([]);
  const [protocol, setProtocol] = React.useState<Proto>("https");
  const [origins, setOrigins] = React.useState<OriginDraft[]>([{ key: originKey++, host: "", port: "443" }]);
  const [originHost, setOriginHost] = React.useState("");
  const [autoCert, setAutoCert] = React.useState(true);
  const [forceHttps, setForceHttps] = React.useState(true);
  const [cachePreset, setCachePreset] = React.useState<CreateSiteRequest["cachePreset"]>("static");
  const [created, setCreated] = React.useState<Site | null>(null);
  const [live, setLive] = React.useState(false);

  // Domain quota: count the domains of existing sites.
  const existing = useQuery({ queryKey: ["sites", "all-domains"], queryFn: () => api.sites({ pageSize: 200 }) });
  const usedDomains = existing.data?.items.reduce((a, s) => a + s.domains.length, 0) ?? 0;
  const quota = me.data?.plan.domainsQuota ?? null;
  const remaining = quota == null ? null : Math.max(0, quota - usedDomains);

  const domainErrors = domains.map((d) => [d, domainError(d)] as const).filter(([, e]) => e);
  const domainsStepError =
    domains.length === 0 ? t("请至少添加一个域名") : domainErrors.length > 0 ? t("请修正格式不正确的域名") : remaining != null && domains.length > remaining ? t("超出套餐域名额度，还可添加 {{n}} 个", { n: remaining }) : null;
  const originErrors = origins.map((o) => ({ host: originHostError(o.host), port: portError(o.port) }));
  const originHostErr = originHost.trim() && domainError(normalizeDomain(originHost)) && !/^[\d.:[\]]+$/.test(originHost) ? t("回源 Host 需为域名") : null;
  const originsStepError = originErrors.some((e) => e.host || e.port) || originHostErr ? t("请检查源站配置") : null;

  const hasWildcard = domains.some((d) => d.startsWith("*."));
  const create = useMutation({
    mutationFn: (body: CreateSiteRequest) => api.createSite(body),
    onSuccess: (site) => {
      setCreated(site);
      setStep(3);
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      toast.success(t("网站已创建"));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields.domains) {
        setStep(0);
      }
      toast.error(errorMessage(e));
    },
  });

  function next() {
    const err = step === 0 ? domainsStepError : step === 1 ? originsStepError : null;
    if (err) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (step === 2) {
      create.mutate({
        domains,
        origins: origins.map((o) => ({ protocol, host: o.host.trim().replace(/^\[|\]$/g, ""), port: Number(o.port) })),
        originHost: originHost.trim() ? normalizeDomain(originHost) : undefined,
        autoCert,
        forceHttps: forceHttps && autoCert,
        cachePreset,
      });
      return;
    }
    setStep((s) => s + 1);
  }

  function changeProtocol(p: Proto) {
    // Ports still at the old default follow the protocol.
    setOrigins((list) => list.map((o) => (Number(o.port) === DEFAULT_PORT[protocol] ? { ...o, port: String(DEFAULT_PORT[p]) } : o)));
    setProtocol(p);
  }

  const steps = [
    { title: t("域名"), description: t("要加速的网站域名") },
    { title: t("源站"), description: t("内容的来源服务器") },
    { title: t("选项"), description: t("HTTPS 与缓存") },
    { title: t("完成"), description: t("添加 CNAME 记录") },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link to="/sites" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            {t("网站")}
          </Link>
        }
        title={t("添加网站")}
        description={t("四步完成接入：填写域名和源站，选择选项，然后在 DNS 服务商处添加 CNAME 记录。")}
      />
      <Card className="overflow-hidden">
        <div className="border-b px-5 py-4 sm:px-6">
          <Stepper steps={steps} current={live ? steps.length : step} onStepClick={created ? undefined : (i) => setStep(i)} />
          <div className="mt-3 text-[13px] font-medium sm:hidden">
            {t("第 {{n}} 步，共 4 步", { n: step + 1 })} · {steps[step]!.title}
          </div>
        </div>

        <div className="px-5 py-6 sm:px-6">
          {step === 0 ? (
            <DomainsStep domains={domains} setDomains={setDomains} remaining={remaining} error={showErrors ? domainsStepError : null} />
          ) : step === 1 ? (
            <OriginsStep
              protocol={protocol}
              setProtocol={changeProtocol}
              origins={origins}
              setOrigins={setOrigins}
              originHost={originHost}
              setOriginHost={setOriginHost}
              errors={showErrors ? originErrors : null}
              originHostErr={showErrors ? originHostErr : null}
              firstDomain={domains[0] ?? "www.example.com"}
            />
          ) : step === 2 ? (
            <OptionsStep
              autoCert={autoCert}
              setAutoCert={setAutoCert}
              forceHttps={forceHttps}
              setForceHttps={setForceHttps}
              cachePreset={cachePreset}
              setCachePreset={setCachePreset}
              hasWildcard={hasWildcard}
              summary={{ domains, protocol, origins }}
            />
          ) : created ? (
            <DoneStep site={created} onLive={() => setLive(true)} />
          ) : null}
        </div>

        {step < 3 ? (
          <div className="flex items-center justify-between gap-3 border-t bg-subtle/60 px-5 py-3 sm:px-6">
            <Button variant="ghost" onClick={() => (step === 0 ? history.back() : setStep(step - 1))} disabled={create.isPending}>
              {step === 0 ? t("取消") : (
                <>
                  <ArrowLeft />
                  {t("上一步")}
                </>
              )}
            </Button>
            <Button onClick={next} loading={create.isPending}>
              {step === 2 ? t("创建网站") : t("下一步")}
              {step < 2 ? <ArrowRight /> : null}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- step 1

function DomainsStep({ domains, setDomains, remaining, error }: { domains: string[]; setDomains: (d: string[]) => void; remaining: number | null; error: string | null }) {
  const { t } = useTranslation();
  const invalid = domains.filter((d) => domainError(d));
  // Suggest the www / apex counterpart of the first valid domain.
  const suggestion = React.useMemo(() => {
    const first = domains.find((d) => !domainError(d) && !d.startsWith("*."));
    if (!first) return null;
    const s = first.startsWith("www.") ? first.slice(4) : first.split(".").length === 2 ? `www.${first}` : null;
    return s && !domains.includes(s) ? s : null;
  }, [domains]);

  return (
    <div className="space-y-5">
      <SectionIntro icon={<Layers />} title={t("要加速哪些域名？")} description={t("同一网站下的多个域名会共用源站与配置。可以一次粘贴多个，用空格、逗号或换行分隔。")} />
      <Field
        label={t("域名")}
        htmlFor="domains"
        aside={
          <span className="text-xs text-muted-foreground tabular">
            {remaining == null ? t("已添加 {{n}} 个", { n: domains.length }) : t("已添加 {{n}} 个 · 套餐剩余 {{m}} 个", { n: domains.length, m: remaining })}
          </span>
        }
        error={error ?? undefined}
        description={t("支持通配符，例如 *.example.com（匹配所有一级子域名）。无需填写 http:// 或路径。")}
      >
        <TagInput
          id="domains"
          value={domains}
          onChange={setDomains}
          validate={(d) => {
            const e = domainError(d);
            return e ? t(e) : null;
          }}
          normalize={normalizeDomain}
          placeholder="www.example.com"
          className="min-h-11 py-2"
          aria-invalid={!!error}
          removeLabel={(d) => t("移除 {{d}}", { d })}
        />
      </Field>
      {invalid.length > 0 ? (
        <div role="alert" className="flex gap-2.5 rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-0.5">
            {invalid.map((d) => (
              <div key={d}>
                <span className="font-mono font-medium">{d}</span>：{t(domainError(d)!)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {suggestion ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          {t("通常也需要加速")}
          <Button variant="outline" size="sm" className="h-7 font-mono text-xs" onClick={() => setDomains([...domains, suggestion])}>
            <Plus />
            {suggestion}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- step 2

function OriginsStep({
  protocol,
  setProtocol,
  origins,
  setOrigins,
  originHost,
  setOriginHost,
  errors,
  originHostErr,
  firstDomain,
}: {
  protocol: Proto;
  setProtocol: (p: Proto) => void;
  origins: OriginDraft[];
  setOrigins: React.Dispatch<React.SetStateAction<OriginDraft[]>>;
  originHost: string;
  setOriginHost: (v: string) => void;
  errors: { host: string | null; port: string | null }[] | null;
  originHostErr: string | null;
  firstDomain: string;
}) {
  const { t } = useTranslation();
  const update = (key: number, patch: Partial<OriginDraft>) => setOrigins((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-6">
      <SectionIntro icon={<ServerCog />} title={t("内容从哪里来？")} description={t("源站是你现有的服务器。边缘节点未命中缓存时，会向源站请求内容。")} />
      <Field label={t("回源协议")}>
        <RadioGroup value={protocol} onValueChange={(v) => setProtocol(v as Proto)} className="grid-cols-1 sm:grid-cols-2" aria-label={t("回源协议")}>
          <RadioCard value="https">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Lock className="size-4 text-success" />
              HTTPS
              <Badge variant="soft" className="ml-1">{t("推荐")}</Badge>
            </span>
            <span className="pr-6 text-[13px] text-muted-foreground">{t("边缘节点与源站之间加密传输，源站需配置有效证书。")}</span>
          </RadioCard>
          <RadioCard value="http">
            <span className="text-sm font-medium">HTTP</span>
            <span className="pr-6 text-[13px] text-muted-foreground">{t("源站未配置证书时使用。访客侧仍可启用 HTTPS。")}</span>
          </RadioCard>
        </RadioGroup>
      </Field>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("源站地址")}</span>
          <span className="text-xs text-muted-foreground">{t("多个源站时轮询分配请求，故障时自动切换")}</span>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_6.5rem_2.25rem] gap-2 text-xs text-muted-foreground" aria-hidden>
            <span>{t("域名或 IP")}</span>
            <span>{t("端口")}</span>
          </div>
          {origins.map((o, i) => {
            const e = errors?.[i];
            return (
              <div key={o.key} className="grid grid-cols-[1fr_6.5rem_auto] items-start gap-2">
                <div>
                  <Input
                    aria-label={t("源站 {{n}} 地址", { n: i + 1 })}
                    placeholder={t("origin.example.com 或 IP 地址")}
                    value={o.host}
                    onChange={(ev) => update(o.key, { host: ev.target.value })}
                    aria-invalid={!!e?.host}
                    className="font-mono text-[13px] placeholder:font-sans"
                    autoFocus={!o.host && i === origins.length - 1}
                  />
                  {e?.host ? <p className="mt-1.5 text-[12.5px] font-medium text-destructive-foreground">{t(e.host)}</p> : null}
                </div>
                <div>
                  <Input
                    aria-label={t("源站 {{n}} 端口", { n: i + 1 })}
                    inputMode="numeric"
                    value={o.port}
                    onChange={(ev) => update(o.key, { port: ev.target.value.replace(/\D/g, "").slice(0, 5) })}
                    aria-invalid={!!e?.port}
                    className="font-mono text-[13px] tabular"
                  />
                  {e?.port ? <p className="mt-1.5 text-[12.5px] font-medium text-destructive-foreground">{t(e.port)}</p> : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  disabled={origins.length === 1}
                  onClick={() => setOrigins((list) => list.filter((x) => x.key !== o.key))}
                  aria-label={t("删除源站 {{n}}", { n: i + 1 })}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
        {origins.length < 10 ? (
          <Button variant="outline" size="sm" className="w-fit border-dashed" onClick={() => setOrigins((list) => [...list, { key: originKey++, host: "", port: String(DEFAULT_PORT[protocol]) }])}>
            <Plus />
            {t("添加源站")}
          </Button>
        ) : null}
      </div>

      <Field
        label={
          <>
            {t("回源 Host")}
            <span className="font-normal text-muted-foreground">（{t("可选")}）</span>
          </>
        }
        htmlFor="origin-host"
        error={originHostErr ?? undefined}
        description={t("请求源站时使用的 Host 头。留空则使用访客访问的域名；源站按域名区分站点（如对象存储、虚拟主机）时需要填写。")}
      >
        <Input id="origin-host" value={originHost} onChange={(e) => setOriginHost(e.target.value)} placeholder={firstDomain} className="font-mono text-[13px] placeholder:font-sans" aria-invalid={!!originHostErr} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- step 3

const PRESETS: { value: CreateSiteRequest["cachePreset"]; icon: React.ReactNode; title: string; desc: string; rules: string[] }[] = [
  {
    value: "static",
    icon: <Zap />,
    title: "静态网站",
    desc: "官网、文档、博客、前端单页应用",
    rules: ["图片、脚本、样式、字体缓存 30 天", "HTML 缓存 1 小时", "其余内容缓存 10 分钟"],
  },
  {
    value: "dynamic",
    icon: <Gauge />,
    title: "动态应用",
    desc: "电商、社区、带登录的 Web 应用",
    rules: ["仅缓存静态资源（7 天）", "/api/ 等动态内容始终回源", "遵循源站的 Cache-Control"],
  },
  {
    value: "none",
    icon: <ZapOff />,
    title: "不缓存",
    desc: "仅使用加速线路与防护",
    rules: ["所有请求都回源", "可随时在缓存设置中添加规则"],
  },
];

function OptionsStep({
  autoCert,
  setAutoCert,
  forceHttps,
  setForceHttps,
  cachePreset,
  setCachePreset,
  hasWildcard,
  summary,
}: {
  autoCert: boolean;
  setAutoCert: (v: boolean) => void;
  forceHttps: boolean;
  setForceHttps: (v: boolean) => void;
  cachePreset: CreateSiteRequest["cachePreset"];
  setCachePreset: (v: CreateSiteRequest["cachePreset"]) => void;
  hasWildcard: boolean;
  summary: { domains: string[]; protocol: Proto; origins: OriginDraft[] };
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-7">
      <div>
        <SectionIntro icon={<Lock />} title="HTTPS" description={t("证书在 CNAME 生效后自动签发与续期，无需任何操作。")} />
        <div className="mt-2 divide-y">
          <SettingRow
            title={<label htmlFor="auto-cert">{t("自动申请 HTTPS 证书")}</label>}
            description={
              hasWildcard ? (
                <span className="text-warning-foreground">{t("通配符域名需要 DNS 验证，无法自动申请，可创建后在「证书」中上传。")}</span>
              ) : (
                t("使用 Let's Encrypt 免费证书，到期前自动续期。")
              )
            }
          >
            <Switch id="auto-cert" checked={autoCert} onCheckedChange={setAutoCert} />
          </SettingRow>
          <SettingRow title={<label htmlFor="force-https">{t("强制 HTTPS")}</label>} description={autoCert ? t("把所有 HTTP 请求 301 跳转到 HTTPS。") : t("需要先为网站配置证书。")}>
            <Switch id="force-https" checked={forceHttps && autoCert} onCheckedChange={setForceHttps} disabled={!autoCert} />
          </SettingRow>
        </div>
      </div>

      <div className="space-y-3">
        <SectionIntro icon={<Zap />} title={t("缓存预设")} description={t("选择最接近你网站类型的预设，创建后可在缓存设置中细调。")} />
        <RadioGroup value={cachePreset} onValueChange={(v) => setCachePreset(v as CreateSiteRequest["cachePreset"])} className="grid-cols-1 md:grid-cols-3" aria-label={t("缓存预设")}>
          {PRESETS.map((p) => (
            <RadioCard key={p.value} value={p.value} className="gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground [&_svg]:size-4">{p.icon}</span>
              <span className="text-sm font-medium">{t(p.title)}</span>
              <span className="text-[13px] text-muted-foreground">{t(p.desc)}</span>
              <ul className="mt-1 space-y-1 border-t pt-2.5 text-xs text-muted-foreground">
                {p.rules.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    {t(r)}
                  </li>
                ))}
              </ul>
            </RadioCard>
          ))}
        </RadioGroup>
      </div>

      <div className="rounded-xl border bg-subtle/60 p-4 text-[13px]">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{t("即将创建")}</div>
        <dl className="grid gap-1.5 sm:grid-cols-[6rem_1fr]">
          <dt className="text-muted-foreground">{t("域名")}</dt>
          <dd className="font-mono break-all">{summary.domains.join("、")}</dd>
          <dt className="text-muted-foreground">{t("源站")}</dt>
          <dd className="font-mono break-all">{summary.origins.map((o) => `${summary.protocol}://${o.host}:${o.port}`).join("、")}</dd>
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- step 4

function DoneStep({ site, onLive }: { site: Site; onLive: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const check = useDnsCheck(site);
  const results = check.data?.results;
  const allOk = results && results.every((r) => r.ok);
  React.useEffect(() => {
    if (allOk) onLive();
  }, [allOk, onLive]);
  const hasApex = site.domains.some((d) => d.split(".").length === 2);
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-foreground">
          <CheckCircle2 className="size-5" />
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">{t("网站已创建，最后一步：添加 CNAME 记录")}</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("请在你的 DNS 服务商处添加以下记录。记录生效后，访客流量将经由边缘节点加速{{https}}。", { https: site.https.autoCert ? t("，HTTPS 证书也会自动签发") : "" })}
          </p>
        </div>
      </div>

      <DnsRecordTable domains={site.domains} cname={site.cname} />
      <DnsProviderTips cname={site.cname} hasApex={hasApex} />

      <div className={cn("space-y-3 rounded-xl border p-4", allOk ? "border-success/30 bg-success-soft/50" : "bg-card")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{allOk ? t("解析已生效，网站开始加速") : t("添加好记录了？")}</div>
            <div className="text-[13px] text-muted-foreground">{allOk ? t("可以前往网站详情查看流量与调整配置。") : t("检测每个域名当前的解析结果。DNS 变更通常几分钟内生效。")}</div>
          </div>
          {allOk ? null : <DnsCheckButton check={check} />}
        </div>
        {results ? <DnsCheckResults results={results} /> : null}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-end">
        <Button variant="ghost" asChild>
          <Link to="/sites">{t("返回网站列表")}</Link>
        </Button>
        <Button onClick={() => navigate(`/sites/${site.id}`)}>
          {t("前往网站详情")}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function SectionIntro({ icon, title, description }: { icon: React.ReactNode; title: React.ReactNode; description: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-subtle text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="space-y-0.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
