import { CopyButton } from "@hcdn/ui/blocks/status";
import { cn } from "@hcdn/ui/lib/cn";

/** Monospace block with a filename tab and a copy button. */
export function CodeBlock({ code, filename, className, copyLabel }: { code: string; filename?: string; className?: string; copyLabel?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-subtle", className)}>
      <div className="flex h-9 items-center justify-between gap-2 border-b bg-muted/50 pr-1.5 pl-3">
        <span className="truncate font-mono text-xs text-muted-foreground">{filename}</span>
        <CopyButton value={code} label={copyLabel} className="h-7" />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}
