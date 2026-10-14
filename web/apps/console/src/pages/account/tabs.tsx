import { useTranslation } from "react-i18next";
import { RouteTabs } from "@/components/route-tabs";

export function AccountTabs() {
  const { t } = useTranslation();
  return (
    <RouteTabs
      className="mb-6"
      items={[
        { to: "/account", label: t("资料与安全"), end: true },
        { to: "/account/keys", label: t("API 密钥") },
      ]}
    />
  );
}
