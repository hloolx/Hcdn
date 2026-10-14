import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Site } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";
import { primaryDomain, SITE_STATUS } from "@/lib/site";

export function SiteStatusBadge({ status, className }: { status: Site["status"]; className?: string }) {
  const { t } = useTranslation();
  const m = SITE_STATUS[status];
  return (
    <StatusBadge tone={m.tone} pulse={m.pulse} className={className}>
      {t(m.label)}
    </StatusBadge>
  );
}

/** Enable/disable and delete with the right confirmations; shared by the list and detail pages. */
export function useSiteActions(opts: { onDeleted?: () => void } = {}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();

  const invalidate = (site?: Site) => {
    void qc.invalidateQueries({ queryKey: ["sites"] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
    if (site) qc.setQueryData(["site", site.id], site);
  };

  const toggle = useMutation({
    mutationFn: (s: Site) => api.updateSite(s.id, { isOn: !s.isOn }),
    onSuccess: (site) => {
      invalidate(site);
      toast.success(site.isOn ? t("网站已启用") : t("网站已停用"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (s: Site) => api.deleteSite(s.id),
    onSuccess: (_d, s) => {
      qc.removeQueries({ queryKey: ["site", s.id] });
      invalidate();
      toast.success(t("已删除 {{domain}}", { domain: primaryDomain(s) }));
      opts.onDeleted?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function askToggle(site: Site) {
    if (!site.isOn) {
      toggle.mutate(site);
      return;
    }
    confirm({
      title: t("停用 {{domain}}？", { domain: primaryDomain(site) }),
      description: t("停用后边缘节点将不再为该网站的 {{n}} 个域名提供服务，访客会看到错误页面。配置会被保留，随时可以重新启用。", { n: site.domains.length }),
      confirmText: t("停用网站"),
      cancelText: t("取消"),
      destructive: true,
      onConfirm: () => toggle.mutateAsync(site),
    });
  }

  function askDelete(site: Site) {
    const domain = primaryDomain(site);
    confirm({
      title: t("删除网站 {{domain}}？", { domain }),
      description: (
        <>
          {t("该网站的全部域名、源站、HTTPS、缓存与安全配置都将被永久删除，且无法恢复。删除前请先把 DNS 解析改回源站，否则访客将无法访问。")}
        </>
      ),
      confirmText: t("永久删除"),
      cancelText: t("取消"),
      destructive: true,
      confirmPhrase: domain,
      confirmPhraseLabel: (
        <>
          {t("请输入网站域名")} <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{domain}</code> {t("以确认")}
        </>
      ),
      onConfirm: () => remove.mutateAsync(site),
    });
  }

  return { askToggle, askDelete, toggling: toggle.isPending ? toggle.variables?.id : undefined, dialog };
}
