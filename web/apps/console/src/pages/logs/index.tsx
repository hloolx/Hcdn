import { useTranslation } from "react-i18next";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { LogViewer } from "@/components/log-viewer";

export function LogsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t("访问日志")} description={t("边缘节点记录的每一次请求，保留 7 天。点击任意一行查看完整字段。")} />
      <LogViewer />
    </div>
  );
}
