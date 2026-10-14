import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { primaryDomain } from "@/lib/site";

export function useSiteOptions() {
  return useQuery({ queryKey: ["sites", "picker"], queryFn: () => api.sites({ pageSize: 200 }), staleTime: 60_000 });
}

/** Site filter: "全部网站" plus every site by its primary domain. */
export function SitePicker({ value, onChange, className, allLabel }: { value: number | undefined; onChange: (id: number | undefined) => void; className?: string; allLabel?: string }) {
  const { t } = useTranslation();
  const q = useSiteOptions();
  return (
    <Select value={value == null ? "all" : String(value)} onValueChange={(v) => onChange(v === "all" ? undefined : Number(v))}>
      <SelectTrigger className={cn("min-w-0", className)} aria-label={t("网站")}>
        <Globe className="text-muted-foreground" />
        <SelectValue className="flex-1 justify-start text-left" placeholder={allLabel ?? t("全部网站")} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value="all">{allLabel ?? t("全部网站")}</SelectItem>
        {q.data?.items.length ? <SelectSeparator /> : null}
        {(q.data?.items ?? []).map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>
            <span className="truncate">{primaryDomain(s)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
