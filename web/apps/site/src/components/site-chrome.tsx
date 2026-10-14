import * as React from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ArrowRight, Menu } from "lucide-react";
import { Logo } from "@hcdn/ui/blocks/logo";
import { ThemeSegmented, ThemeToggle } from "@hcdn/ui/blocks/theme-toggle";
import { Button } from "@hcdn/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@hcdn/ui/components/sheet";
import { cn } from "@hcdn/ui/lib/cn";
import { LOGIN_URL, REGISTER_URL } from "@/lib/links";

const NAV = [
  { to: "/#features", label: "产品" },
  { to: "/network", label: "节点网络" },
  { to: "/pricing", label: "价格" },
  { to: "/docs", label: "文档" },
];

function Navbar() {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const location = useLocation();
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  React.useEffect(() => setOpen(false), [location.pathname, location.hash]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled ? "border-b bg-background/75 backdrop-blur-lg supports-[backdrop-filter]:bg-background/60" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5">
        <Link to="/" aria-label="Hcdn">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  isActive && !n.to.includes("#") && "text-foreground",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <a href={LOGIN_URL}>登录</a>
          </Button>
          <Button size="sm" asChild className="hidden sm:inline-flex">
            <a href={REGISTER_URL}>
              免费开始
              <ArrowRight />
            </a>
          </Button>
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setOpen(true)} aria-label="菜单">
            <Menu />
          </Button>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-80 gap-0 p-0">
          <SheetTitle className="flex h-16 items-center px-5">
            <Logo />
          </SheetTitle>
          <nav className="flex flex-col gap-1 px-3 py-2">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-lg px-3 py-2.5 text-[15px] hover:bg-accent">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto grid gap-2 border-t p-4">
            <Button variant="outline" asChild>
              <a href={LOGIN_URL}>登录</a>
            </Button>
            <Button asChild>
              <a href={REGISTER_URL}>免费开始</a>
            </Button>
            <ThemeSegmented className="mx-auto mt-2" />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function Footer() {
  const cols = [
    { title: "产品", links: [{ to: "/#features", label: "功能" }, { to: "/network", label: "节点网络" }, { to: "/pricing", label: "价格" }] },
    { title: "资源", links: [{ to: "/docs", label: "快速开始" }, { to: "/docs#api", label: "API" }, { to: "/docs#security", label: "安全防护" }] },
    { title: "法律", links: [{ to: "/terms", label: "服务条款" }, { to: "/privacy", label: "隐私政策" }, { to: "/aup", label: "可接受使用政策" }] },
  ];
  return (
    <footer className="border-t bg-subtle/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">面向出海与亚太业务的边缘加速与安全平台。</p>
          <ThemeSegmented />
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="text-sm font-semibold">{c.title}</div>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Hcdn. All rights reserved.</span>
          <span>部分组件基于 GoEdge 开源项目（BSD-3-Clause）二次开发</span>
        </div>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  const location = useLocation();
  React.useEffect(() => {
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [location.pathname, location.hash]);
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
