import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@hcdn/ui/components/button";
import { cn } from "@hcdn/ui/lib/cn";

/** Footer for paged tables: "1–20 / 136" plus prev/next and a compact page list. */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const list = pageList(page, pages);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground", className)}>
      <span className="tabular">{t("第 {{from}}–{{to}} 条，共 {{total}} 条", { from, to, total })}</span>
      {pages > 1 ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t("上一页")}>
            <ChevronLeft />
          </Button>
          {list.map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="w-6 text-center">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "outline" : "ghost"}
                size="icon-xs"
                className={cn("tabular", p === page && "font-semibold text-foreground")}
                onClick={() => onChange(p)}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </Button>
            ),
          )}
          <Button variant="ghost" size="icon-xs" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label={t("下一页")}>
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function pageList(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pages - 1) out.push("…");
  out.push(pages);
  return out;
}
