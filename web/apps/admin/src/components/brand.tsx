import { useTranslation } from "react-i18next";
import { Logo } from "@hcdn/ui/blocks/logo";
import { cn } from "@hcdn/ui/lib/cn";

export function AdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-[5px] bg-admin-accent-soft px-1.5 text-[10px] leading-none font-semibold tracking-[0.08em] text-admin-accent ring-1 ring-admin-accent/25 ring-inset",
        className,
      )}
    >
      ADMIN
    </span>
  );
}

/** Logo + "管理后台" + ADMIN badge: the operator-console identity. */
export function AdminBrand({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)}>
      <Logo suffix={t("管理后台")} />
      <AdminBadge />
    </span>
  );
}
