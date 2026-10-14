import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/button";

/** Page numbers to show, with null for an ellipsis gap. */
function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((p) => set.add(p));
  const sorted = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/** Footer pagination for tables: range summary on the left, pages on the right. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  summary,
  prevLabel = "上一页",
  nextLabel = "下一页",
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** e.g. (from, to, total) => `第 ${from}–${to} 条，共 ${total} 条` */
  summary?: (from: number, to: number, total: number) => React.ReactNode;
  prevLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground", className)}>
      <div className="tabular">{summary ? summary(from, to, total) : `${from}–${to} / ${total}`}</div>
      {pages > 1 ? (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={prevLabel}>
            <ChevronLeft />
          </Button>
          {pageWindow(page, pages).map((p, i) =>
            p == null ? (
              <span key={`gap-${i}`} className="w-6 text-center">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "outline" : "ghost"}
                size="icon-sm"
                className={cn("tabular", p === page ? "font-semibold text-foreground" : "text-muted-foreground")}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            ),
          )}
          <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label={nextLabel}>
            <ChevronRight />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
