import * as React from "react";
import { useSearchParams } from "react-router";
import { errorMessage } from "@hcdn/api/client";
import { toast } from "@hcdn/ui/components/toaster";
import i18n from "./i18n";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * List filters kept in the URL (?keyword=&page=…) so back/forward and shared
 * links restore the view. Changing any filter resets the page to 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ""])) as Record<K, string>;
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const set = React.useCallback(
    (patch: Partial<Record<K | "page", string | number>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === "" || v == null || (k === "page" && Number(v) <= 1)) next.delete(k);
            else next.set(k, String(v));
          }
          if (!("page" in patch)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return { values, page, set };
}

export function toastError(e: unknown, title?: string) {
  const msg = errorMessage(e);
  if (title) toast.error(i18n.t(title), { description: i18n.t(msg) });
  else toast.error(i18n.t(msg));
}
