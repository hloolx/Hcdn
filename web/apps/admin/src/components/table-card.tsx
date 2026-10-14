import * as React from "react";
import { cn } from "@hcdn/ui/lib/cn";

/** Bordered surface for a list: optional toolbar row on top, table, footer. */
export function TableCard({ toolbar, footer, className, children }: { toolbar?: React.ReactNode; footer?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">{toolbar}</div> : null}
      {children}
      {footer}
    </div>
  );
}
