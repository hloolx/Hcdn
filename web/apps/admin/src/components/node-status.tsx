import { useTranslation } from "react-i18next";
import type { NodeSummary } from "@hcdn/api/types";
import { StatusBadge, StatusDot, type StatusTone } from "@hcdn/ui/blocks/status";

export type NodeState = "online" | "offline" | "disabled" | "pending";

export function nodeState(n: Pick<NodeSummary, "isOn" | "isUp" | "isInstalled">): NodeState {
  if (!n.isOn) return "disabled";
  if (!n.isInstalled) return "pending";
  return n.isUp ? "online" : "offline";
}

const META: Record<NodeState, { tone: StatusTone; label: string }> = {
  online: { tone: "success", label: "在线" },
  offline: { tone: "danger", label: "离线" },
  disabled: { tone: "neutral", label: "已停用" },
  pending: { tone: "info", label: "待安装" },
};

export function NodeStatusBadge({ node }: { node: Pick<NodeSummary, "isOn" | "isUp" | "isInstalled"> }) {
  const { t } = useTranslation();
  const s = nodeState(node);
  return <StatusBadge tone={META[s].tone}>{t(META[s].label)}</StatusBadge>;
}

export function NodeStatusDot({ node }: { node: Pick<NodeSummary, "isOn" | "isUp" | "isInstalled"> }) {
  const { t } = useTranslation();
  const s = nodeState(node);
  return (
    <span title={t(META[s].label)} className="inline-flex">
      <StatusDot tone={META[s].tone} pulse={s === "online"} />
      <span className="sr-only">{t(META[s].label)}</span>
    </span>
  );
}
