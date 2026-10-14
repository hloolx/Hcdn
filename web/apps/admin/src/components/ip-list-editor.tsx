import * as React from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Button } from "@hcdn/ui/components/button";
import { Input } from "@hcdn/ui/components/input";
import { cn } from "@hcdn/ui/lib/cn";
import { isIPOrCidr } from "@/lib/net";

/** Editable list of IPs / CIDR ranges. Accepts pasted multi-line input. */
export function IpListEditor({
  value,
  onChange,
  placeholder = "203.0.113.0/24",
  emptyText,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  function add() {
    const entries = text
      .split(/[\s,，;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (entries.length === 0) return;
    const bad = entries.filter((e) => !isIPOrCidr(e));
    if (bad.length) {
      setError(t("无效的 IP 或 CIDR：{{v}}", { v: bad.slice(0, 3).join("、") }));
      return;
    }
    const fresh = entries.filter((e, i) => !value.includes(e) && entries.indexOf(e) === i);
    if (fresh.length === 0) {
      setError(t("已在列表中"));
      return;
    }
    onChange([...value, ...fresh]);
    setText("");
    setError(null);
  }

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="font-mono text-[13px]"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
          aria-label={t("添加 IP 或 CIDR")}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!text.trim()}>
          <Plus />
          {t("添加")}
        </Button>
      </div>
      {error ? <p className="text-[12.5px] font-medium text-destructive-foreground">{error}</p> : null}
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-3 text-[13px] text-muted-foreground">{emptyText}</div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {value.map((ip) => (
            <li key={ip} className="flex h-9 items-center gap-2 bg-subtle/60 pr-1 pl-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{ip}</span>
              <span className="text-[11px] text-muted-foreground">{ip.includes(":") ? "IPv6" : "IPv4"}</span>
              <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive-foreground" onClick={() => onChange(value.filter((v) => v !== ip))} aria-label={t("移除 {{ip}}", { ip })}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
