import * as React from "react";
import { NavLink } from "react-router";
import { cn } from "@hcdn/ui/lib/cn";

/** Underline tabs whose items are routes (same look as TabsUnderlineList). */
export function RouteTabs({ items, className }: { items: { to: string; label: React.ReactNode; end?: boolean; icon?: React.ReactNode }[]; className?: string }) {
  return (
    <nav className={cn("flex w-full items-center gap-5 overflow-x-auto border-b scrollbar-thin", className)}>
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          className={({ isActive }) =>
            cn(
              "relative -mb-px inline-flex shrink-0 items-center gap-1.5 rounded-t-sm border-b-2 px-0.5 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-4",
              isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )
          }
        >
          {i.icon}
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
