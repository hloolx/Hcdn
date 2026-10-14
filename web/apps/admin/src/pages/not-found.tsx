import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@hcdn/ui/blocks/states";
import { Button } from "@hcdn/ui/components/button";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      className="py-24"
      icon={<FileQuestion />}
      title={t("页面不存在")}
      description={t("你访问的页面可能已被移动或删除。")}
      action={
        <Button asChild variant="outline">
          <Link to="/">{t("返回仪表盘")}</Link>
        </Button>
      }
    />
  );
}
