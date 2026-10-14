import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@hcdn/ui/blocks/states";
import { Button } from "@hcdn/ui/components/button";

export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="space-y-4 text-center">
        <ErrorState title={t("页面出错了")} error={message} onRetry={() => window.location.reload()} retryLabel={t("刷新页面")} />
        <Button variant="link" asChild>
          <Link to="/">{t("返回概览")}</Link>
        </Button>
      </div>
    </div>
  );
}
