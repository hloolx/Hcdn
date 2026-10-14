import { useTranslation } from "react-i18next";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState } from "@hcdn/ui/blocks/states";

/** Temporary page body for routes that are still being built. */
export function Placeholder({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t(title)} />
      <EmptyState title={t("即将上线")} description={t("该页面正在建设中。")} />
    </div>
  );
}
