import * as React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookOpen,
  Globe,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  UserRound,
  Zap,
  Plus,
} from "lucide-react";
import { AppShell, type LinkLike, type NavGroup } from "@hcdn/ui/blocks/app-shell";
import { Logo } from "@hcdn/ui/blocks/logo";
import { ThemeToggle } from "@hcdn/ui/blocks/theme-toggle";
import { CommandPalette, CommandTrigger, useCommandShortcut, type CommandItem } from "@hcdn/ui/blocks/command-palette";
import { Button } from "@hcdn/ui/components/button";
import { DropdownMenuItem } from "@hcdn/ui/components/dropdown-menu";
import { Progress } from "@hcdn/ui/components/misc";
import { formatBytes } from "@hcdn/ui/lib/format";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { RequireAuth, useMe } from "@/lib/auth";
import { LangToggle } from "@/components/lang-toggle";

const RouterLink: LinkLike = ({ href, className, children, onClick }) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
);

function PlanCard() {
  const { t } = useTranslation();
  const me = useMe();
  const overview = useQuery({ queryKey: ["overview", "30d"], queryFn: () => api.overview("30d"), staleTime: 5 * 60_000 });
  const plan = me.data?.plan;
  const used = overview.data?.totals.bytes ?? 0;
  const quota = plan?.trafficQuotaBytes ?? null;
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div className="rounded-xl border border-sidebar-border bg-background/60 p-3 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{plan?.name ?? t("免费版")}</span>
        <Link to="/account" className="text-xs font-medium text-primary hover:underline">
          {t("升级套餐")}
        </Link>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between text-[11.5px] text-muted-foreground">
        <span>{t("本月流量")}</span>
        <span className="tabular">
          {formatBytes(used)}
          {quota ? ` / ${formatBytes(quota, 0)}` : ""}
        </span>
      </div>
      <Progress value={quota ? pct : 4} className="mt-1.5 h-1" indicatorClassName={pct > 90 ? "bg-destructive" : undefined} />
    </div>
  );
}

function ConsoleShell() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  useCommandShortcut(React.useCallback(() => setPaletteOpen((v) => !v), []));

  const sites = useQuery({ queryKey: ["sites", "palette"], queryFn: () => api.sites({ pageSize: 50 }), enabled: paletteOpen });

  const nav: NavGroup[] = [
    {
      items: [
        { href: "/", label: t("概览"), icon: LayoutDashboard, exact: true },
        { href: "/sites", label: t("网站"), icon: Globe },
        { href: "/certs", label: t("证书"), icon: ShieldCheck },
        { href: "/cache", label: t("缓存"), icon: Zap },
        { href: "/stats", label: t("统计分析"), icon: BarChart3 },
        { href: "/logs", label: t("访问日志"), icon: ScrollText },
      ],
    },
    {
      title: t("账号"),
      items: [
        { href: "/account", label: t("账号设置"), icon: UserRound, exact: true },
        { href: "/account/keys", label: t("API 密钥"), icon: KeyRound },
      ],
    },
  ];

  const commands: CommandItem[] = [
    ...nav.flatMap((g) =>
      g.items.map((i) => ({
        id: `page:${i.href}`,
        label: String(i.label),
        group: t("页面"),
        icon: i.icon,
        onSelect: () => navigate(i.href),
      })),
    ),
    { id: "action:new-site", label: t("添加网站"), group: t("操作"), icon: Plus, onSelect: () => navigate("/sites/new") },
    ...(sites.data?.items ?? []).map((s) => ({
      id: `site:${s.id}`,
      label: s.domains[0] ?? s.name,
      hint: s.domains.length > 1 ? `+${s.domains.length - 1}` : undefined,
      group: t("网站"),
      icon: Globe,
      keywords: s.domains,
      onSelect: () => navigate(`/sites/${s.id}`),
    })),
  ];

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* the session may already be gone */
    }
    qc.clear();
    toast.success(t("已退出登录"));
    navigate("/login", { replace: true });
  }

  return (
    <>
      <AppShell
        brand={
          <Link to="/" className="outline-none">
            <Logo suffix={t("控制台")} />
          </Link>
        }
        nav={nav}
        pathname={location.pathname}
        Link={RouterLink}
        topbarLeft={<CommandTrigger label={t("搜索网站或页面…")} onClick={() => setPaletteOpen(true)} />}
        topbarRight={
          <>
            <Button variant="ghost" size="sm" className="hidden text-muted-foreground sm:inline-flex" asChild>
              <a href="https://hcdn.dev/docs" target="_blank" rel="noreferrer">
                <BookOpen />
                {t("文档")}
              </a>
            </Button>
            <LangToggle />
            <ThemeToggle lang={i18n.language === "en" ? "en" : "zh"} />
          </>
        }
        sidebarFooter={<PlanCard />}
        user={
          me.data
            ? {
                name: me.data.fullname || me.data.username,
                email: me.data.email,
                logoutLabel: t("退出登录"),
                onLogout: logout,
                menu: (
                  <>
                    <DropdownMenuItem onSelect={() => navigate("/account")}>
                      <UserRound />
                      {t("账号设置")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate("/account/keys")}>
                      <KeyRound />
                      {t("API 密钥")}
                    </DropdownMenuItem>
                  </>
                ),
              }
            : undefined
        }
      >
        <Outlet />
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={commands}
        placeholder={t("搜索网站或页面…")}
        emptyText={t("没有匹配的结果")}
      />
    </>
  );
}

export function ConsoleLayout() {
  return (
    <RequireAuth>
      <ConsoleShell />
    </RequireAuth>
  );
}
