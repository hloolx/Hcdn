import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "../components/label";

/** Label + control + help text + error, with consistent spacing. */
export function Field({
  label,
  htmlFor,
  description,
  error,
  required,
  className,
  children,
  aside,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      {label || aside ? (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <Label htmlFor={htmlFor}>
              {label}
              {required ? <span className="text-destructive">*</span> : null}
            </Label>
          ) : (
            <span />
          )}
          {aside}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="text-[12.5px] font-medium text-destructive-foreground">{error}</p>
      ) : description ? (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** Two-column settings row: title/description on the left, control on the right. */
export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8", className)}>
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium">{title}</div>
        {description ? <div className="text-[13px] leading-relaxed text-muted-foreground">{description}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
