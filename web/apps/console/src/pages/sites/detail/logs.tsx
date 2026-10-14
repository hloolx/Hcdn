import { LogViewer } from "@/components/log-viewer";
import { useSite } from "./layout";

export function SiteLogsTab() {
  const site = useSite();
  return <LogViewer key={site.id} siteId={site.id} />;
}
