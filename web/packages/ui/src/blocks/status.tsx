import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/button";
import { toast } from "sonner";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneDot: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground/60",
};

const toneText: Record<StatusTone, string> = {
  success: "text-success-foreground bg-success-soft",
  warning: "text-warning-foreground bg-warning-soft",
  danger: "text-destructive-foreground bg-destructive-soft",
  info: "text-info-foreground bg-info-soft",
  neutral: "text-muted-foreground bg-muted",
};

export function StatusDot({ tone = "neutral", pulse = false, className }: { tone?: StatusTone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {pulse ? <span className={cn("absolute inset-0 rounded-full animate-pulse-ring", toneDot[tone])} /> : null}
      <span className={cn("relative inline-flex size-2 rounded-full", toneDot[tone])} />
    </span>
  );
}

export function StatusBadge({
  tone = "neutral",
  pulse,
  children,
  className,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneText[tone], className)}>
      <StatusDot tone={tone} pulse={pulse} className="size-1.5 [&>span]:size-1.5" />
      {children}
    </span>
  );
}

export function CopyButton({
  value,
  label,
  className,
  successText = "已复制",
}: {
  value: string;
  label?: React.ReactNode;
  className?: string;
  successText?: string;
}) {
  const [done, setDone] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      toast.success(successText);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  }
  return (
    <Button type="button" variant={label ? "outline" : "ghost"} size={label ? "sm" : "icon-xs"} onClick={copy} className={className} aria-label="Copy">
      {done ? <Check className="text-success" /> : <Copy />}
      {label}
    </Button>
  );
}

/** Monospace value with an inline copy button (CNAME targets, keys, IDs). */
export function CopyField({ value, className, mask = false }: { value: string; className?: string; mask?: boolean }) {
  const [shown, setShown] = React.useState(!mask);
  return (
    <div className={cn("flex h-9 items-center gap-1 rounded-md border bg-subtle pr-1 pl-3 font-mono text-[13px]", className)}>
      <span className="min-w-0 flex-1 truncate select-all">{shown ? value : "•".repeat(Math.min(24, value.length))}</span>
      {mask ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 font-sans text-xs" onClick={() => setShown((v) => !v)}>
          {shown ? "隐藏" : "显示"}
        </Button>
      ) : null}
      <CopyButton value={value} />
    </div>
  );
}
