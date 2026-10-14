import * as React from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/button";
import { Skeleton } from "../components/skeleton";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-8" : "gap-3 py-14", className)}>
      <div className="relative">
        <div className="absolute inset-0 -m-3 rounded-full bg-primary/5 blur-xl" />
        <div className="relative flex size-12 items-center justify-center rounded-2xl border border-dashed border-border-strong bg-card text-muted-foreground shadow-xs [&_svg]:size-5">
          {icon ?? <Inbox />}
        </div>
      </div>
      <div className="max-w-sm space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "加载失败",
  error,
  onRetry,
  retryLabel = "重试",
  className,
}: {
  title?: React.ReactNode;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : null;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-2xl bg-destructive-soft text-destructive-foreground [&_svg]:size-5">
        <AlertTriangle />
      </div>
      <div className="max-w-md space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {message ? <p className="text-[13px] break-words text-muted-foreground">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Skeleton rows for tables and lists. */
export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
