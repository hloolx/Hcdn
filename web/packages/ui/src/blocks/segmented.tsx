import { cn } from "../lib/cn";

/** Compact segmented control for filters such as time ranges. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "default",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex items-center rounded-lg border bg-subtle p-0.5 shadow-xs", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2.5 font-medium whitespace-nowrap text-muted-foreground transition-all outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]",
              active && "bg-background text-foreground shadow-sm dark:bg-input/50",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
