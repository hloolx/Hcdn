import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";

export function useClusters() {
  return useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: 60_000 });
}

/** Cluster picker. With `allLabel`, an extra "all" entry maps to "". */
export function ClusterSelect({
  value,
  onChange,
  allLabel,
  id,
  className,
  size,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel?: string;
  id?: string;
  className?: string;
  size?: "sm" | "default";
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const clusters = useClusters();
  return (
    <Select value={value === "" && allLabel ? "all" : value} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
      <SelectTrigger id={id} size={size} className={cn("w-full", className)} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={clusters.isPending ? t("加载中…") : t("选择集群")} />
      </SelectTrigger>
      <SelectContent>
        {allLabel ? <SelectItem value="all">{allLabel}</SelectItem> : null}
        {(clusters.data ?? []).map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
