import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Return an error message for an invalid tag, or null. Invalid tags are kept but highlighted. */
  validate?: (tag: string) => string | null;
  /** Clean up a raw entry before it becomes a tag (trim, lowercase, strip scheme…). */
  normalize?: (raw: string) => string;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Max number of tags. */
  max?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  removeLabel?: (tag: string) => string;
}

const SPLIT = /[\s,，;；]+/;

/**
 * Free-form multi-value input: Enter, comma, space or paste commit entries;
 * Backspace on an empty field removes the last tag.
 */
export function TagInput({
  value,
  onChange,
  validate,
  normalize = (s) => s.trim(),
  placeholder,
  id,
  className,
  disabled,
  max,
  removeLabel = (t) => `Remove ${t}`,
  ...aria
}: TagInputProps) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const entries = raw
      .split(SPLIT)
      .map(normalize)
      .filter(Boolean);
    if (entries.length === 0) return;
    const next = [...value];
    for (const e of entries) {
      if (next.includes(e)) continue;
      if (max != null && next.length >= max) break;
      next.push(e);
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        commit(draft);
      }
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow,border-color] hover:border-border-strong focus-within:border-primary/60 focus-within:ring-[3px] focus-within:ring-ring dark:bg-input/25",
        aria["aria-invalid"] && "border-destructive ring-destructive/20",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => {
        const error = validate?.(tag) ?? null;
        return (
          <span
            key={tag}
            title={error ?? undefined}
            className={cn(
              "inline-flex h-6 max-w-full items-center gap-1 rounded-md border pr-0.5 pl-2 font-mono text-[12.5px]",
              error ? "border-destructive/40 bg-destructive-soft text-destructive-foreground" : "border-border bg-muted text-foreground",
            )}
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded text-muted-foreground transition hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={removeLabel(tag)}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((t) => t !== tag));
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (SPLIT.test(v) && v.trim()) commit(v);
          else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (SPLIT.test(text.trim())) {
            e.preventDefault();
            commit(draft + text);
          }
        }}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="h-6 min-w-32 flex-1 bg-transparent px-1 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground/80"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
      />
    </div>
  );
}
