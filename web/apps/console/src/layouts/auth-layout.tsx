import { Link, Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { Gauge, Globe2, ShieldCheck, Zap } from "lucide-react";
import { Logo } from "@hcdn/ui/blocks/logo";
import { ThemeToggle } from "@hcdn/ui/blocks/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";

function NetworkArt() {
  // Decorative edge network: nodes linked to a core, with traffic flowing along the links.
  const nodes = [
    { x: 70, y: 70 },
    { x: 250, y: 46 },
    { x: 330, y: 150 },
    { x: 300, y: 262 },
    { x: 120, y: 280 },
    { x: 40, y: 180 },
  ];
  const core = { x: 190, y: 165 };
  return (
    <svg viewBox="0 0 380 320" className="h-auto w-full max-w-md" aria-hidden>
      <defs>
        <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8ab4ff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#8ab4ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="link" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a5c4ff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7dd8f0" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {nodes.map((n, i) => (
        <g key={i}>
          <line x1={core.x} y1={core.y} x2={n.x} y2={n.y} stroke="url(#link)" strokeWidth="1.2" />
          <line
            x1={core.x}
            y1={core.y}
            x2={n.x}
            y2={n.y}
            stroke="#c9dcff"
            strokeWidth="1.6"
            strokeDasharray="3 37"
            strokeLinecap="round"
            className="animate-dash"
            style={{ animationDelay: `${i * -0.45}s` }}
          />
        </g>
      ))}
      {nodes.map((n, i) => (
        <g key={`n${i}`} className="animate-float" style={{ animationDelay: `${i * -0.9}s` }}>
          <circle cx={n.x} cy={n.y} r="14" fill="#ffffff" fillOpacity="0.06" stroke="#ffffff" strokeOpacity="0.18" />
          <circle cx={n.x} cy={n.y} r="4" fill="#d9e6ff" />
        </g>
      ))}
      <circle cx={core.x} cy={core.y} r="58" fill="url(#core-glow)" opacity="0.35" />
      <circle cx={core.x} cy={core.y} r="26" fill="#ffffff" fillOpacity="0.1" stroke="#ffffff" strokeOpacity="0.35" />
      <path
        d={`M${core.x - 8} ${core.y - 9}v18M${core.x + 8} ${core.y - 9}v18M${core.x - 8} ${core.y}h12M${core.x + 1} ${core.y - 4}l4 4-4 4`}
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function AuthLayout() {
  const { t, i18n } = useTranslation();
  const features = [
    { icon: Globe2, title: t("亚太边缘节点"), desc: t("东京、洛杉矶等多地节点，就近接入，降低延迟") },
    { icon: Zap, title: t("免备案，分钟级接入"), desc: t("添加域名、配置 CNAME，即可开始加速") },
    { icon: ShieldCheck, title: t("内置安全防护"), desc: t("WAF、IP 黑白名单、地区封禁、按 IP 限速") },
    { icon: Gauge, title: t("实时数据"), desc: t("流量、请求、命中率与访问日志一目了然") },
  ];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.2_0.06_268)] text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,oklch(0.45_0.2_268/0.55),transparent_70%),radial-gradient(50%_45%_at_90%_90%,oklch(0.55_0.14_210/0.45),transparent_70%)]" />
        <div className="absolute inset-0 [background-image:linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]" />
        <div className="relative z-10 flex flex-1 flex-col p-10 xl:p-14">
          <Link to="/" className="w-fit">
            <Logo className="[&_span]:text-white" />
          </Link>
          <div className="mt-auto max-w-lg">
            <NetworkArt />
            <h2 className="mt-8 text-3xl leading-tight font-semibold tracking-tight text-balance">
              {t("让每一次访问，都从离用户最近的地方开始")}
            </h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2">
              {features.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                    <f.icon className="size-4.5 text-sky-200" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{f.title}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-white/60">{f.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-12 text-xs text-white/40">© {new Date().getFullYear()} Hcdn</div>
        </div>
      </aside>
      <main className="relative flex flex-col">
        <div className="flex items-center justify-between p-5 lg:justify-end">
          <Link to="/" className="lg:hidden">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <LangToggle />
            <ThemeToggle lang={i18n.language === "en" ? "en" : "zh"} />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-16">
          <div className="w-full max-w-[380px]">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

export function AuthHeader({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-8 space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
