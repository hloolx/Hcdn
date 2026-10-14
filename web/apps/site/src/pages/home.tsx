import * as React from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BarChart3,
  Ban,
  Check,
  Code2,
  Database,
  FileCheck2,
  Fingerprint,
  Gauge,
  Globe2,
  Lock,
  MapPinned,
  ShieldCheck,
  Sparkles,
  Timer,
  Zap,
} from "lucide-react";
import { DotMap } from "@hcdn/ui/charts/dot-map";
import { Button } from "@hcdn/ui/components/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@hcdn/ui/components/accordion";
import { StatusDot } from "@hcdn/ui/blocks/status";
import { Meter } from "@hcdn/ui/charts/bar-list";
import { cn } from "@hcdn/ui/lib/cn";
import { ConsolePreview } from "@/components/console-preview";
import { ARCS, FAQS, NODES, PLANS } from "@/lib/site-data";
import { REGISTER_URL } from "@/lib/links";

function useCounter(target: number, ms = 1400) {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Hero() {
  const blocked = useCounter(12840);
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.62_0.2_265/0.22),transparent)] blur-2xl" />
      <div className="pointer-events-none absolute top-20 right-[8%] h-72 w-72 rounded-full bg-[radial-gradient(closest-side,oklch(0.78_0.13_205/0.22),transparent)] blur-2xl" />

      <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-10 text-center md:pt-24">
        <Link
          to="/network"
          className="group mx-auto inline-flex items-center gap-2 rounded-full border bg-background/70 py-1 pr-3 pl-1 text-[13px] shadow-xs backdrop-blur transition hover:border-border-strong"
        >
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-foreground">新节点</span>
          <span className="text-muted-foreground">东京与洛杉矶节点已上线</span>
          <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
        <h1 className="mx-auto mt-7 max-w-4xl text-[40px] leading-[1.1] font-semibold tracking-tight text-balance sm:text-6xl md:text-[68px]">
          让亚太访问，
          <br className="hidden sm:block" />
          <span className="text-gradient">快得理所当然</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground text-balance sm:text-lg">
          Hcdn 是面向出海与亚太业务的 CDN：就近的边缘节点、自动 HTTPS、内置 WAF 与实时数据。
          添加域名，改一条 CNAME，几分钟内即可上线，无需备案。
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="xl" variant="gradient" asChild className="w-full sm:w-auto">
            <a href={REGISTER_URL}>
              免费开始
              <ArrowRight />
            </a>
          </Button>
          <Button size="xl" variant="outline" asChild className="w-full bg-background/60 sm:w-auto">
            <Link to="/docs">查看接入文档</Link>
          </Button>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
          {["无需备案", "自动 HTTPS", "按 IP 限速与 WAF", "实时日志"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 text-success" />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-5 pb-20">
        <div className="relative rounded-[28px] border bg-gradient-to-b from-card to-subtle/50 p-3 shadow-lg sm:p-6">
          <DotMap nodes={NODES} arcs={ARCS} className="opacity-95" />
          <FloatCard className="top-[10%] left-[3%] hidden md:flex" delay="0s">
            <span className="flex size-8 items-center justify-center rounded-lg bg-success-soft text-success-foreground">
              <Timer className="size-4" />
            </span>
            <div className="text-left">
              <div className="text-[11px] text-muted-foreground">东京节点 · TLS 握手</div>
              <div className="text-sm font-semibold tabular">
                <StatusDot tone="success" pulse className="mr-1.5" />
                在线 · 低延迟
              </div>
            </div>
          </FloatCard>
          <FloatCard className="right-[4%] bottom-[16%] hidden w-56 flex-col items-stretch md:flex" delay="-2s">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>缓存命中率</span>
              <span className="font-semibold text-foreground tabular">94.2%</span>
            </div>
            <Meter value={0.942} className="mt-1.5" />
          </FloatCard>
          <FloatCard className="bottom-[10%] left-[22%] hidden lg:flex" delay="-4s">
            <span className="flex size-8 items-center justify-center rounded-lg bg-destructive-soft text-destructive-foreground">
              <ShieldCheck className="size-4" />
            </span>
            <div className="text-left">
              <div className="text-[11px] text-muted-foreground">今日已拦截恶意请求</div>
              <div className="text-sm font-semibold tabular">{blocked.toLocaleString("zh-CN")}</div>
            </div>
          </FloatCard>
        </div>
      </div>
    </section>
  );
}

function FloatCard({ className, children, delay }: { className?: string; children: React.ReactNode; delay: string }) {
  return (
    <div
      className={cn("absolute items-center gap-3 rounded-xl border bg-background/85 px-3.5 py-2.5 shadow-md backdrop-blur-md animate-float", className)}
      style={{ animationDelay: delay }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, desc, className }: { eyebrow: string; title: React.ReactNode; desc?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      <div className="text-sm font-semibold text-primary">{eyebrow}</div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {desc ? <p className="mt-4 text-base leading-relaxed text-muted-foreground text-balance">{desc}</p> : null}
    </div>
  );
}

function BentoCard({ className, icon: Icon, title, desc, children }: { className?: string; icon: React.ComponentType<{ className?: string }>; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <div className={cn("group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-md", className)}>
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
      {children ? <div className="mt-6 flex-1">{children}</div> : null}
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-t bg-subtle/40 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionTitle eyebrow="一站式边缘平台" title="加速、证书、防护与数据，开箱即用" desc="不需要拼装多个服务。添加网站后，HTTPS、缓存、WAF 与实时统计自动就位，你只需要关注业务。" />
        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <BentoCard className="md:col-span-4" icon={Globe2} title="亚太边缘网络" desc="东京、洛杉矶节点覆盖东亚与北美，更多亚太城市持续上线。访客自动就近接入，跨洋访问不再绕路。">
            <div className="relative -mx-2 -mb-2">
              <DotMap nodes={NODES} arcs={ARCS.slice(0, 7)} showLabels={false} latTop={58} latBottom={-38} centerLon={145} />
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-2" icon={Zap} title="免备案，分钟级接入" desc="无需迁移 DNS，只要添加一条 CNAME 记录。">
            <div className="space-y-2 font-mono text-[12px]">
              <div className="rounded-lg border bg-subtle px-3 py-2">
                <span className="text-muted-foreground">类型</span> <span className="ml-2 font-semibold text-primary">CNAME</span>
              </div>
              <div className="rounded-lg border bg-subtle px-3 py-2">
                <span className="text-muted-foreground">主机</span> <span className="ml-2">www</span>
              </div>
              <div className="truncate rounded-lg border bg-subtle px-3 py-2">
                <span className="text-muted-foreground">值</span> <span className="ml-2">a1b2c3d4.cdn.hcdn.dev</span>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-2" icon={Lock} title="自动 HTTPS" desc="一键申请免费证书并自动续期，支持上传自有证书、TLS 1.3 与 HTTP/2。">
            <div className="flex items-center gap-3 rounded-xl border bg-subtle p-3">
              <FileCheck2 className="size-8 text-success" />
              <div className="min-w-0 text-[12.5px]">
                <div className="truncate font-medium">www.example.com</div>
                <div className="text-muted-foreground">自动续期 · 剩余 86 天</div>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-2" icon={ShieldCheck} title="WAF 与访问控制" desc="规则化 WAF、IP 黑白名单、地区封禁、按 IP 限速，一处配置全网生效。">
            <div className="space-y-1.5 text-[12.5px]">
              {[
                { icon: Ban, text: "SQL 注入 · 已拦截", tone: "text-destructive-foreground" },
                { icon: Fingerprint, text: "每 IP 60 秒 300 次", tone: "text-warning-foreground" },
                { icon: MapPinned, text: "地区封禁 · 3 个国家", tone: "text-info-foreground" },
              ].map((r) => (
                <div key={r.text} className="flex items-center gap-2 rounded-lg border bg-subtle px-3 py-2">
                  <r.icon className={cn("size-3.5", r.tone)} />
                  {r.text}
                </div>
              ))}
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-2" icon={Database} title="智能缓存" desc="按扩展名、路径或正则设置缓存时间，一键刷新与预热。">
            <div className="rounded-xl border bg-subtle p-3">
              <div className="flex justify-between text-[12px] text-muted-foreground">
                <span>命中率</span>
                <span className="font-semibold text-foreground">91.8%</span>
              </div>
              <Meter value={0.918} className="mt-2" />
              <div className="mt-3 flex justify-between text-[12px] text-muted-foreground">
                <span>回源流量节省</span>
                <span className="font-semibold text-foreground">-87%</span>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-3" icon={BarChart3} title="实时统计与访问日志" desc="流量、带宽、请求、命中率、状态码与地区分布实时可见，访问日志支持按 IP、状态码与关键词检索。">
            <MiniBars />
          </BentoCard>
          <BentoCard className="md:col-span-3" icon={Code2} title="开放 API" desc="用 AccessKey 调用 API，把网站管理、证书与缓存刷新接入你的发布流程。">
            <pre className="overflow-x-auto rounded-xl border bg-[oklch(0.18_0.01_270)] p-4 font-mono text-[12px] leading-relaxed text-[oklch(0.9_0.01_270)] scrollbar-thin">
              {CURL_LINES.map((line, i) => (
                <React.Fragment key={i}>
                  {line.cmd ? <span className="text-[oklch(0.75_0.12_205)]">{line.cmd}</span> : null}
                  {line.text}
                  {line.str ? <span className="text-[oklch(0.8_0.12_140)]">{line.str}</span> : null}
                  {line.cont ? " \\" : ""}
                  {i < CURL_LINES.length - 1 ? "\n" : ""}
                </React.Fragment>
              ))}
            </pre>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

const CURL_LINES: { cmd?: string; text: string; str?: string; cont?: boolean }[] = [
  { cmd: "curl", text: " -X POST", cont: true },
  { text: "  https://api.hcdn.dev/v1/cache/purge", cont: true },
  { text: "  -H ", str: '"Authorization: Bearer $TOKEN"', cont: true },
  { text: "  -d ", str: `'{"targets":["/app.js"]}'` },
];

function MiniBars() {
  // Illustrative hourly requests, stacked: cached (primary) vs origin (muted).
  const bars = [32, 28, 24, 22, 25, 34, 48, 61, 66, 63, 58, 60, 64, 70, 72, 69, 74, 83, 92, 100, 96, 81, 62, 44];
  return (
    <div className="flex h-28 items-end gap-[3px] rounded-xl border bg-subtle p-3">
      {bars.map((h, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end gap-px" style={{ height: `${h}%` }}>
          <div className="rounded-t-[3px] bg-primary" style={{ height: "82%" }} />
          <div className="bg-muted-foreground/25" style={{ height: "18%" }} />
        </div>
      ))}
    </div>
  );
}

function Steps() {
  const steps = [
    { n: "01", title: "添加网站", desc: "填写域名与源站地址，选择缓存预设。证书可一键自动申请。", icon: Sparkles },
    { n: "02", title: "配置 CNAME", desc: "在现有 DNS 服务商处把域名指向我们分配的 CNAME，控制台实时检测是否生效。", icon: Globe2 },
    { n: "03", title: "开始加速", desc: "流量经边缘节点就近响应，缓存命中的请求不再回源，攻击在边缘被拦截。", icon: Gauge },
  ];
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionTitle eyebrow="三步上线" title="从注册到加速，只需几分钟" />
        <div className="relative mt-14 grid gap-6 md:grid-cols-3">
          <div className="pointer-events-none absolute top-7 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-border-strong to-transparent md:block" />
          {steps.map((s) => (
            <div key={s.n} className="relative text-center">
              <div className="relative mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
                <s.icon className="size-6 text-primary" />
                <span className="absolute -top-2 -right-2 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary-foreground">{s.n}</span>
              </div>
              <h3 className="mt-6 text-lg font-semibold">{s.title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Showcase() {
  return (
    <section className="relative overflow-hidden border-y bg-subtle/40 py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="mx-auto max-w-6xl px-5">
        <SectionTitle eyebrow="控制台" title="看得见的每一个字节" desc="清晰的数据面板让你随时掌握流量、缓存与安全状况。亮色与暗色主题，桌面与手机都好用。" />
        <div className="relative mt-14">
          <div className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 bg-[radial-gradient(50%_40%_at_50%_0%,oklch(0.62_0.2_265/0.16),transparent)]" />
          <ConsolePreview />
        </div>
      </div>
    </section>
  );
}

function Security() {
  const items = [
    { icon: ShieldCheck, title: "规则化 WAF", desc: "覆盖 SQL 注入、XSS、路径穿越等常见攻击，可选拦截或仅记录。" },
    { icon: Fingerprint, title: "按 IP 限速", desc: "每个 IP 在时间窗口内的请求上限，超限自动封禁，抵御 CC 攻击。" },
    { icon: Ban, title: "IP 黑白名单", desc: "按 IP 或网段放行、拒绝，配置秒级下发到所有节点。" },
    { icon: MapPinned, title: "地区封禁", desc: "按国家或地区限制访问，满足合规与业务需要。" },
  ];
  return (
    <section className="relative overflow-hidden bg-[oklch(0.17_0.03_268)] py-24 text-white">
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_75%)]" />
      <div className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,oklch(0.55_0.2_265/0.45),transparent)] blur-2xl" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-2 lg:items-center">
        <div>
          <div className="text-sm font-semibold text-sky-300">安全防护</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">攻击在边缘止步，源站安然无恙</h2>
          <p className="mt-4 max-w-lg leading-relaxed text-white/65">
            所有请求先经过边缘节点的 WAF 与访问控制，恶意流量不会到达你的源站。防护规则基于访客真实 IP，日志里每一次拦截都有据可查。
          </p>
          <Button size="lg" asChild className="mt-8 bg-white text-[oklch(0.2_0.03_268)] hover:bg-white/90">
            <Link to="/docs#security">
              了解防护配置
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((i) => (
            <div key={i.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
              <i.icon className="size-5 text-sky-300" />
              <div className="mt-4 font-semibold">{i.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{i.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingTeaser() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionTitle eyebrow="价格" title="简单透明，按需升级" desc="从免费版开始，业务增长后随时升级。" />
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-6 shadow-xs",
                p.highlight && "border-primary/40 shadow-glow",
              )}
            >
              {p.highlight ? (
                <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">最受欢迎</span>
              ) : null}
              <div className="font-semibold">{p.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{p.tagline}</div>
              <div className="mt-5 flex items-baseline gap-1">
                {p.monthly == null ? (
                  <span className="text-3xl font-semibold tracking-tight">定制</span>
                ) : (
                  <>
                    <span className="text-lg font-medium text-muted-foreground">¥</span>
                    <span className="text-4xl font-semibold tracking-tight">{p.monthly}</span>
                    <span className="text-sm text-muted-foreground">/ 月</span>
                  </>
                )}
              </div>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {p.features.slice(0, 5).map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-7" variant={p.highlight ? "default" : "outline"} asChild>
                {p.monthly == null ? <a href="mailto:sales@hcdn.dev">{p.cta}</a> : <a href={REGISTER_URL}>{p.cta}</a>}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Button variant="link" asChild>
            <Link to="/pricing">
              查看完整套餐对比
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="border-t bg-subtle/40 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <div className="text-sm font-semibold text-primary">常见问题</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">还有疑问？</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            找不到答案？查看 <Link to="/docs" className="text-primary hover:underline">接入文档</Link>，或在控制台提交工单。
          </p>
        </div>
        <Accordion type="single" collapsible className="rounded-2xl border bg-card px-6 shadow-xs">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`q${i}`}>
              <AccordionTrigger>{f.q}</AccordionTrigger>
              <AccordionContent>{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="relative overflow-hidden rounded-3xl bg-brand-gradient px-8 py-16 text-center text-white shadow-glow sm:px-16">
          <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgb(255_255_255/0.18)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <h2 className="relative text-3xl font-semibold tracking-tight text-balance sm:text-4xl">几分钟内，让你的网站在亚太快起来</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-white/80">免费版即可体验完整的加速、证书与防护能力，无需绑定信用卡。</p>
          <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="xl" asChild className="bg-white text-[oklch(0.3_0.12_265)] shadow-lg hover:bg-white/90">
              <a href={REGISTER_URL}>
                免费开始
                <ArrowRight />
              </a>
            </Button>
            <Button size="xl" variant="ghost" asChild className="text-white hover:bg-white/10 hover:text-white">
              <Link to="/pricing">查看价格</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <Steps />
      <Showcase />
      <Security />
      <PricingTeaser />
      <Faq />
      <Cta />
    </>
  );
}
