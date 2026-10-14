import * as React from "react";
import { cn } from "../lib/cn";
import { Button } from "../components/button";

/**
 * Floating bar that slides in when a settings form has unsaved changes.
 * Place it at the end of the form; it sticks to the bottom of the viewport.
 */
export function SaveBar({
  open,
  onSave,
  onReset,
  saving,
  message = "有未保存的更改",
  saveLabel = "保存更改",
  resetLabel = "放弃",
  className,
}: {
  open: boolean;
  onSave: () => void;
  onReset: () => void;
  saving?: boolean;
  message?: React.ReactNode;
  saveLabel?: string;
  resetLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none sticky bottom-4 z-20 mt-4 flex justify-center transition-all duration-200",
        open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        className,
      )}
      aria-hidden={!open}
    >
      <div
        role="status"
        className={cn(
          "flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border bg-popover/95 py-2 pr-2 pl-4 shadow-lg backdrop-blur-md",
          open && "pointer-events-auto",
        )}
      >
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span className="size-1.5 rounded-full bg-warning" />
          {message}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={saving || !open} tabIndex={open ? 0 : -1}>
            {resetLabel}
          </Button>
          <Button type="button" size="sm" onClick={onSave} loading={saving} disabled={!open} tabIndex={open ? 0 : -1}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
