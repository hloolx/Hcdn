import * as React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Award,
  Boxes,
  Globe,
  LayoutDashboard,
  Network,
  Plus,
  ScrollText,
  Server,
  Settings,
  UserPlus,
  Users,
  Waypoints,
} from "lucide-react";
import { AppShell, type LinkLike, type NavGroup } from "@hcdn/ui/blocks/app-shell";
import { ThemeToggle } from "@hcdn/ui/blocks/theme-toggle";
import { StatusDot } from "@hcdn/ui/blocks/status";
import { CommandPalette, CommandTrigger, useCommandShortcut, type CommandItem } from "@hcdn/ui/blocks/command-palette";
import { DropdownMenuItem } from "@hcdn/ui/components/dropdown-menu";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { RequireAuth, useMe } from "@/lib/auth";
import { LangToggle } from "@/components/lang-toggle";
import { AdminBrand } from "@/components/brand";
import { nodeState } from "@/components/node-status";

const RouterLink: LinkLike = ({ href, className, children, onClick }) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
);

export function useAllNodes() {
  return useQuery({ queryKey: ["nodes", "all"], queryFn: () => api.nodes({ pageSize: 500 }), staleTime: 30_000, refetchInterval: 60_000 });
}

/** Sidebar footer: live fleet status at a glance. */
function FleetStatus() {
  const { t } = useTranslation();
  const q = useAllNodes();
  const items = q.data?.items ?? [];
  const states = items.map(nodeState);
  const online = states.filter((s) => s === "online").length;
  const offline = states.filter((s) => s === "offline").length;
  const total = items.length;
  const unknown = q.isError || (!q.isPending && total === 0);
  const tone = unknown ? "neutral" : offline > 0 ? "danger" : "success";
  return (
    <Link
      to="/nodes"
      className="block rounded-xl border border-sidebar-border bg-background/70 p-3 shadow-xs transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{t("边缘网络")}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <StatusDot tone={tone} pulse={tone === "success" && !unknown} />
          {q.isPending ? "…" : q.isError ? t("状态未知") : total === 0 ? t("尚无节点") : offline > 0 ? t("{{n}} 个节点离线", { n: offline }) : t("运行正常")}
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1">
        <span className="text-lg leading-none font-semibold tabular">{q.isPending || q.isError ? "—" : online}</span>
        <span className="text-xs text-muted-foreground tabular">/ {q.isPending || q.isError ? "—" : total}</span>
        <span className="ml-1 text-xs text-muted-foreground">{t("节点在线")}</span>
      </div>
      {total > 0 ? (
        <div className="mt-2 flex gap-0.5" aria-hidden>
          {states.map((s, i) => (
            <span
              key={i}
              className={
                "h-1.5 flex-1 rounded-full " +
                (s === "online" ? "bg-success" : s === "offline" ? "bg-destructive" : s === "pending" ? "bg-info/60" : "bg-muted-foreground/30")
              }
            />
          ))}
        </div>
      ) : null}
    </Link>
  );
}

function AdminShell() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const nodes = useAllNodes();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  useCommandShortcut(React.useCallback(() => setPaletteOpen((v) => !v), []));
  const users = useQuery({ queryKey: ["users", "palette"], queryFn: () => api.users({ pageSize: 100 }), enabled: paletteOpen });

  const offline = (nodes.data?.items ?? []).filter((n) => nodeState(n) === "offline").length;

  const nav: NavGroup[] = [
    { items: [{ href: "/", label: t("仪表盘"), icon: LayoutDashboard, exact: true }] },
    {
      title: t("基础设施"),
      items: [
        {
          href: "/nodes",
          label: t("节点"),
          icon: Server,
          badge: offline > 0 ? (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive-soft px-1.5 text-[11px] font-semibold text-destructive-foreground tabular" title={t("{{n}} 个节点离线", { n: offline })}>
              {offline}
            </span>
          ) : undefined,
        },
        { href: "/clusters", label: t("集群"), icon: Boxes },
        { href: "/dns", label: t("DNS"), icon: Waypoints },
      ],
    },
    {
      title: t("租户"),
      items: [
        { href: "/users", label: t("用户"), icon: Users },
        { href: "/sites", label: t("网站"), icon: Globe },
        { href: "/certs", label: t("证书"), icon: Award },
      ],
    },
    {
      title: t("系统"),
      items: [
        { href: "/settings", label: t("系统设置"), icon: Settings },
        { href: "/audit-logs", label: t("审计日志"), icon: ScrollText },
      ],
    },
  ];

  const commands: CommandItem[] = [
    ...nav.flatMap((g) =>
      g.items.map((i) => ({ id: `page:${i.href}`, label: String(i.label), group: t("页面"), icon: i.icon, onSelect: () => navigate(i.href) })),
    ),
    { id: "action:add-node", label: t("添加节点"), group: t("操作"), icon: Plus, onSelect: () => navigate("/nodes?add=1") },
    { id: "action:add-user", label: t("创建用户"), group: t("操作"), icon: UserPlus, onSelect: () => navigate("/users?create=1") },
    ...(nodes.data?.items ?? []).map((n) => ({
      id: `node:${n.id}`,
      label: n.name,
      hint: n.ips[0],
      group: t("节点"),
      icon: Network,
      keywords: [...n.ips, n.region],
      onSelect: () => navigate(`/nodes/${n.id}`),
    })),
    ...(users.data?.items ?? []).map((u) => ({
      id: `user:${u.id}`,
      label: u.username,
      hint: u.fullname,
      group: t("用户"),
      icon: Users,
      keywords: [u.email, u.fullname],
      onSelect: () => navigate(`/users?keyword=${encodeURIComponent(u.username)}`),
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
            <AdminBrand />
          </Link>
        }
        nav={nav}
        pathname={location.pathname}
        Link={RouterLink}
        topbarLeft={<CommandTrigger label={t("搜索页面、节点或用户…")} onClick={() => setPaletteOpen(true)} />}
        topbarRight={
          <>
            <LangToggle />
            <ThemeToggle lang={i18n.language === "en" ? "en" : "zh"} />
          </>
        }
        sidebarFooter={<FleetStatus />}
        user={
          me.data
            ? {
                name: me.data.fullname || me.data.username,
                email: `@${me.data.username} · ${me.data.isSuper ? t("超级管理员") : t("管理员")}`,
                logoutLabel: t("退出登录"),
                onLogout: logout,
                menu: (
                  <>
                    <DropdownMenuItem onSelect={() => navigate("/settings")}>
                      <Settings />
                      {t("系统设置")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate("/audit-logs")}>
                      <ScrollText />
                      {t("审计日志")}
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
        placeholder={t("搜索页面、节点或用户…")}
        emptyText={t("没有匹配的结果")}
      />
    </>
  );
}

export function AdminLayout() {
  return (
    <RequireAuth>
      <AdminShell />
    </RequireAuth>
  );
}
