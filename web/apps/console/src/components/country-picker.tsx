import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@hcdn/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@hcdn/ui/components/popover";
import { cn } from "@hcdn/ui/lib/cn";
import { COUNTRY_CODES, countryName } from "@/lib/countries";
import { currentLocale } from "@/lib/i18n";

/** Monospace region code in a small "flag-like" tile. */
export function CountryCode({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-4.5 w-7 shrink-0 items-center justify-center rounded-[4px] border bg-gradient-to-b from-background to-muted font-mono text-[10px] font-semibold tracking-wide text-muted-foreground shadow-xs", className)}>
      {code}
    </span>
  );
}

/** Searchable multi-select of countries/regions with removable chips. */
export function CountryPicker({ value, onChange, id, disabled }: { value: string[]; onChange: (v: string[]) => void; id?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const listRef = React.useRef<HTMLDivElement>(null);
  const options = React.useMemo(() => COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c, locale), en: countryName(c, "en") })), [locale]);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q) || o.en.toLowerCase().includes(q)) : options;
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" className="w-full justify-between font-normal text-muted-foreground sm:w-80" disabled={disabled}>
            <span>{value.length ? t("已选择 {{n}} 个国家/地区", { n: value.length }) : t("选择要拦截的国家/地区")}</span>
            <ChevronDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.querySelector<HTMLButtonElement>("[role=option]")?.focus();
                }
                if (e.key === "Enter" && filtered.length === 1) toggle(filtered[0]!.code);
              }}
              placeholder={t("搜索国家/地区或代码")}
              aria-label={t("搜索国家/地区或代码")}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} role="listbox" aria-multiselectable onKeyDown={onListKey} className="max-h-72 overflow-y-auto p-1 scrollbar-thin">
            {filtered.length === 0 ? <div className="py-6 text-center text-[13px] text-muted-foreground">{t("没有匹配的国家/地区")}</div> : null}
            {filtered.map((o) => {
              const selected = value.includes(o.code);
              return (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => toggle(o.code)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <CountryCode code={o.code} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <Check className={cn("size-4 text-primary", selected ? "opacity-100" : "opacity-0")} />
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span key={c} className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background pr-0.5 pl-1.5 text-[13px] shadow-xs">
              <CountryCode code={c} />
              {countryName(c, locale)}
              <button
                type="button"
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => toggle(c)}
                aria-label={t("移除 {{d}}", { d: countryName(c, locale) })}
                disabled={disabled}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
