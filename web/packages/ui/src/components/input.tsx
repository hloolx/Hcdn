import * as React from "react";
import { cn } from "../lib/cn";

const inputBase =
  "flex w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground/80 selection:bg-primary selection:text-primary-foreground hover:border-border-strong focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/25";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputBase,
        "h-9 py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Input with leading/trailing adornments (icons, prefixes like "https://"). */
function InputGroup({
  className,
  leading,
  trailing,
  inputClassName,
  ...props
}: React.ComponentProps<"input"> & { leading?: React.ReactNode; trailing?: React.ReactNode; inputClassName?: string }) {
  return (
    <div className={cn("relative flex items-center", className)}>
      {leading ? (
        <span className="pointer-events-none absolute left-3 flex items-center text-muted-foreground [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      <Input className={cn(leading ? "pl-9" : "", trailing ? "pr-9" : "", inputClassName)} {...props} />
      {trailing ? <span className="absolute right-2 flex items-center text-muted-foreground">{trailing}</span> : null}
    </div>
  );
}

export { Input, InputGroup, inputBase };
