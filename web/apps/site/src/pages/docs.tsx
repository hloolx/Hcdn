import * as React from "react";
import { Link } from "react-router";
import { Info, TriangleAlert } from "lucide-react";
import { cn } from "@hcdn/ui/lib/cn";
import { CONSOLE_URL } from "@/lib/links";

const SECTIONS = [
  { id: "quickstart", title: "快速开始" },
  { id: "add-site", title: "添加网站" },
  { id: "cname", title: "配置 CNAME" },
  { id: "https", title: "HTTPS 证书" },
  { id: "cache", title: "缓存与刷新" },
  { id: "security", title: "安全防护" },
  { id: "stats", title: "统计与日志" },
  { id: "api", title: "API 访问" },
  { id: "origin", title: "源站最佳实践" },
];

function Callout({ tone = "info", children }: { tone?: "info" | "warning"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <div className={cn("my-5 flex gap-3 rounded-xl border p-4 text-sm leading-relaxed", tone === "warning" ? "border-warning/30 bg-warning-soft" : "border-info/30 bg-info-soft")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning-foreground" : "text-info-foreground")} />
      <div>{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-xl border bg-[oklch(0.18_0.01_270)] p-4 font-mono text-[12.5px] leading-relaxed text-[oklch(0.9_0.01_270)]">
      {children}
    </pre>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-t pt-10 text-2xl font-semibold tracking-tight first:border-0 first:pt-0">
      {children}
    </h2>
  );
}

const P = ({ children }: { children: React.ReactNode }) => <p className="mt-4 leading-[1.85] text-muted-foreground">{children}</p>;

export function DocsPage() {
  const [active, setActive] = React.useState("quickstart");
  React.useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-0.5">
          <div className="mb-3 px-3 text-xs font-semibold tracking-wide text-muted-foreground">文档</div>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                "block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                active === s.id && "bg-accent font-medium text-foreground",
              )}
            >
              {s.title}
            </a>
          ))}
        </nav>
      </aside>
      <article className="min-w-0 max-w-3xl space-y-10 text-[15px]">
        <header>
          <div className="text-sm font-semibold text-primary">Hcdn 文档</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">接入指南</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">从添加第一个网站到配置 HTTPS、缓存与安全防护的完整步骤。</p>
        </header>

        <section>
          <H2 id="quickstart">快速开始</H2>
          <P>
            1. 在 <a href={`${CONSOLE_URL}/register`} className="text-primary hover:underline">控制台</a> 注册账号；2. 添加网站并填写源站；3. 在你的 DNS 服务商处添加 CNAME 记录；4. 等待控制台显示“运行中”。整个过程通常在 10 分钟内完成。
          </P>
        </section>

        <section>
          <H2 id="add-site">添加网站</H2>
          <P>在控制台“网站”页面点击“添加网站”，填写需要加速的域名（可以填多个，例如 www.example.com 与 example.com），然后填写源站：</P>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>回源协议：源站支持 HTTPS 时建议选择 HTTPS。</li>
            <li>源站地址：IP 或域名，例如 origin.example.com。</li>
            <li>回源 Host：默认使用访客请求的域名，源站按其他域名区分站点时可修改。</li>
          </ul>
          <Callout>源站不需要对公网开放全部端口。建议只允许 Hcdn 节点访问源站，避免被绕过 CDN 直接攻击。</Callout>
        </section>

        <section>
          <H2 id="cname">配置 CNAME</H2>
          <P>添加网站后，你会得到一个形如 a1b2c3d4.cdn.hcdn.dev 的 CNAME 记录值。在 DNS 服务商处为每个域名添加记录：</P>
          <Code>{"类型    主机记录    记录值\nCNAME   www         a1b2c3d4.cdn.hcdn.dev"}</Code>
          <Callout tone="warning">
            如果你的域名托管在 Cloudflare，请把这条记录设为“仅 DNS”（灰色云朵）。开启代理（橙色云朵）后流量会经过 Cloudflare 而不是 Hcdn。
          </Callout>
          <P>根域名（example.com）在部分 DNS 服务商处不能设置 CNAME，可使用服务商提供的 CNAME 拉平（ALIAS/ANAME）功能。</P>
        </section>

        <section>
          <H2 id="https">HTTPS 证书</H2>
          <P>
            在网站的 HTTPS 设置中开启“自动申请证书”，解析生效后系统会自动签发并在到期前续期。也可以在“证书”页面上传自有证书（PEM 格式的证书链与私钥）。建议同时开启“强制 HTTPS”和 HTTP/2。
          </P>
        </section>

        <section>
          <H2 id="cache">缓存与刷新</H2>
          <P>缓存规则按顺序匹配，支持按扩展名、路径前缀或正则匹配，并设置缓存时间。常见配置：</P>
          <Code>{"*.css, *.js, *.png, *.jpg, *.woff2   缓存 30 天\n/api/                                 不缓存\n其他                                  缓存 10 分钟"}</Code>
          <P>更新了静态文件后，在“缓存”页面按 URL 或目录刷新；新版本上线前，可以对重要资源进行预热。</P>
        </section>

        <section>
          <H2 id="security">安全防护</H2>
          <P>每个网站都可以独立配置：</P>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>WAF：拦截 SQL 注入、XSS、路径穿越等攻击，可选择“拦截”或“仅记录”。</li>
            <li>IP 黑白名单：按 IP 或网段放行、拒绝访问。</li>
            <li>地区封禁：按国家或地区限制访问。</li>
            <li>按 IP 限速：例如每个 IP 每 60 秒最多 300 次请求，超出后封禁 10 分钟。</li>
          </ul>
        </section>

        <section>
          <H2 id="stats">统计与日志</H2>
          <P>“统计分析”展示流量、带宽、请求数、缓存命中率、状态码与访客地区分布。“访问日志”可按网站、时间、状态码、IP 与关键词检索每一条请求。</P>
        </section>

        <section>
          <H2 id="api">API 访问</H2>
          <P>在“账号设置 → API 密钥”创建 AccessKey（密钥只显示一次，请妥善保存），即可通过 API 管理网站、证书与缓存。</P>
          <Code>{'curl -X POST https://api.hcdn.dev/v1/cache/purge \\\n  -H "Authorization: Bearer $HCDN_TOKEN" \\\n  -d \'{"keyType":"url","targets":["https://www.example.com/app.js"]}\''}</Code>
        </section>

        <section>
          <H2 id="origin">源站最佳实践</H2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground">
            <li>为静态资源设置合理的 Cache-Control，避免对动态接口设置长缓存。</li>
            <li>源站读取访客真实 IP 时，请使用 X-Forwarded-For 或 X-Real-IP 请求头。</li>
            <li>源站配置默认证书或拒绝未知 Host，避免源站 IP 被扫描后暴露真实网站。</li>
          </ul>
          <div className="mt-10 rounded-2xl border bg-subtle/60 p-6 text-sm text-muted-foreground">
            还有问题？在控制台提交工单，或返回 <Link to="/" className="text-primary hover:underline">首页</Link>。
          </div>
        </section>
      </article>
    </div>
  );
}
