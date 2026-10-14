import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface StepDef {
  title: React.ReactNode;
  description?: React.ReactNode;
}

/**
 * Horizontal progress indicator for multi-step flows. Completed steps can be
 * revisited through `onStepClick`; upcoming steps are not clickable.
 */
export function Stepper({
  steps,
  current,
  onStepClick,
  className,
}: {
  steps: StepDef[];
  /** 0-based index of the active step. */
  current: number;
  onStepClick?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex w-full items-start", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = done && !!onStepClick;
        const content = (
          <>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors tabular",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary bg-primary-soft text-primary-soft-foreground ring-4 ring-primary/10",
                !done && !active && "border-border-strong bg-background text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="hidden min-w-0 text-left sm:block">
              <span className={cn("block text-[13px] font-medium", active || done ? "text-foreground" : "text-muted-foreground")}>{step.title}</span>
              {step.description ? <span className="block truncate text-xs text-muted-foreground">{step.description}</span> : null}
            </span>
          </>
        );
        return (
          <li key={i} className={cn("flex min-w-0 items-center", i < steps.length - 1 && "flex-1")} aria-current={active ? "step" : undefined}>
            {clickable ? (
              <button type="button" onClick={() => onStepClick(i)} className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                {content}
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-2.5">{content}</div>
            )}
            {i < steps.length - 1 ? (
              <span className={cn("mx-3 h-px min-w-4 flex-1 transition-colors", done ? "bg-primary" : "bg-border-strong")} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
