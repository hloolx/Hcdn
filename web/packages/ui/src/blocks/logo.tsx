import * as React from "react";
import { cn } from "../lib/cn";

/** Hcdn mark: an "H" whose crossbar is a forward arrow (traffic forwarded at the edge). */
export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("size-7 shrink-0", className)} {...props}>
      <defs>
        <linearGradient id={`${id}-g`} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.55 0.23 270)" />
          <stop offset="0.55" stopColor="oklch(0.6 0.2 248)" />
          <stop offset="1" stopColor="oklch(0.76 0.14 205)" />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="16" y1="0" x2="16" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-g)`} />
      <rect width="32" height="32" rx="9" fill={`url(#${id}-s)`} />
      <path d="M10 8.5v15M22 8.5v15" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 16h10.2M17.2 12.6 20.6 16l-3.4 3.4" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, suffix, compact = false }: { className?: string; suffix?: React.ReactNode; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark />
      {compact ? null : (
        <span className="flex items-baseline gap-1.5">
          <span className="text-[17px] leading-none font-semibold tracking-tight">Hcdn</span>
          {suffix ? <span className="text-xs font-medium text-muted-foreground">{suffix}</span> : null}
        </span>
      )}
    </span>
  );
}
