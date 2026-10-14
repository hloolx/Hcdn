import * as React from "react";
import { Menu, LogOut, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/button";
import { Sheet, SheetContent, SheetTitle } from "../components/sheet";
import { Avatar, AvatarFallback } from "../components/misc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/dropdown-menu";

export interface NavItem {
  href: string;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  /** Match nested routes (default: prefix match except for "/"). */
  exact?: boolean;
}

export interface NavGroup {
  title?: React.ReactNode;
  items: NavItem[];
}

export type LinkLike = React.ComponentType<{ href: string; className?: string; children: React.ReactNode; onClick?: () => void }>;

export interface AppShellUser {
  name: string;
  email?: string;
  menu?: React.ReactNode;
  onLogout?: () => void;
  logoutLabel?: string;
}

export interface AppShellProps {
  brand: React.ReactNode;
  nav: NavGroup[];
  pathname: string;
  Link: LinkLike;
  topbarLeft?: React.ReactNode;
  topbarRight?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  user?: AppShellUser;
  children: React.ReactNode;
  contentClassName?: string;
}

function isActive(item: NavItem, pathname: string) {
  if (item.exact || item.href === "/") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href.endsWith("/") ? item.href : item.href + "/");
}

function SidebarNav({ nav, pathname, Link, onNavigate }: { nav: NavGroup[]; pathname: string; Link: LinkLike; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5 px-3 py-2">
      {nav.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.title ? (
            <div className="px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/80">{group.title}</div>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)]",
                )}
              >
                {active ? <span className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-full bg-primary" /> : null}
                {Icon ? (
                  <Icon className={cn("size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground", active && "text-primary group-hover:text-primary")} />
                ) : null}
                <span className="truncate">{item.label}</span>
                {item.badge ? <span className="ml-auto">{item.badge}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function initials(name: string) {
  const s = name.trim();
  if (!s) return "?";
  if (/[一-龥]/.test(s[0] ?? "")) return s.slice(0, 1);
  return s.slice(0, 2).toUpperCase();
}

function UserMenu({ user, align = "end", wide = false }: { user: AppShellUser; align?: "start" | "end"; wide?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {wide ? (
          <button className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-sidebar-accent">
            <Avatar className="size-8">
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{user.name}</span>
              {user.email ? <span className="block truncate text-xs text-muted-foreground">{user.email}</span> : null}
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>
        ) : (
          <button className="rounded-full ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="size-8">
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium text-foreground">{user.name}</div>
          {user.email ? <div className="truncate text-xs text-muted-foreground">{user.email}</div> : null}
        </DropdownMenuLabel>
        {user.menu ? (
          <>
            <DropdownMenuSeparator />
            {user.menu}
          </>
        ) : null}
        {user.onLogout ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={user.onLogout}>
              <LogOut />
              {user.logoutLabel ?? "退出登录"}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  brand,
  nav,
  pathname,
  Link,
  topbarLeft,
  topbarRight,
  sidebarFooter,
  user,
  children,
  contentClassName,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  React.useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh bg-background text-sm">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-14 items-center px-5">{brand}</div>
        <div className="flex-1 overflow-y-auto pb-4 scrollbar-thin">
          <SidebarNav nav={nav} pathname={pathname} Link={Link} />
        </div>
        {sidebarFooter ? <div className="px-3 pb-2">{sidebarFooter}</div> : null}
        {user ? (
          <div className="border-t border-sidebar-border p-2">
            <UserMenu user={user} align="start" wide />
          </div>
        ) : null}
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
          <SheetTitle className="flex h-14 items-center px-5">{brand}</SheetTitle>
          <div className="flex-1 overflow-y-auto pb-4">
            <SidebarNav nav={nav} pathname={pathname} Link={Link} onNavigate={() => setMobileOpen(false)} />
          </div>
          {sidebarFooter ? <div className="px-3 pb-3">{sidebarFooter}</div> : null}
        </SheetContent>
      </Sheet>

      <div className="flex min-h-dvh flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/65 lg:px-8">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <Menu />
          </Button>
          <div className="lg:hidden">{brand}</div>
          <div className="hidden min-w-0 flex-1 items-center lg:flex">{topbarLeft}</div>
          <div className="ml-auto flex items-center gap-1.5">
            {topbarRight}
            {user ? (
              <div className="ml-1 lg:hidden">
                <UserMenu user={user} />
              </div>
            ) : null}
          </div>
        </header>
        <main className={cn("mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8", contentClassName)}>{children}</main>
      </div>
    </div>
  );
}
