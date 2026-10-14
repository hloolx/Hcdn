import { DotMap } from "@hcdn/ui/charts/dot-map";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { ARCS, NODES } from "@/lib/site-data";

const REGIONS = [
  { city: "东京", country: "日本", region: "东亚", status: "online" as const, note: "覆盖日本、韩国、中国大陆东部与港台" },
  { city: "洛杉矶", country: "美国", region: "北美西海岸", status: "online" as const, note: "覆盖北美与跨太平洋访问" },
  { city: "香港", country: "中国香港", region: "东亚", status: "planned" as const, note: "规划中" },
  { city: "新加坡", country: "新加坡", region: "东南亚", status: "planned" as const, note: "规划中" },
  { city: "首尔", country: "韩国", region: "东亚", status: "planned" as const, note: "规划中" },
  { city: "台北", country: "中国台湾", region: "东亚", status: "planned" as const, note: "规划中" },
];

export function NetworkPage() {
  const online = REGIONS.filter((r) => r.status === "online").length;
  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_60%_70%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-5 pt-20 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">节点网络</h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            边缘节点部署在离访客更近的城市。访客通过 DNS 就近接入，节点故障时自动从解析中摘除，访问不中断。
          </p>
          <div className="mt-6 flex justify-center gap-3 text-sm">
            <StatusBadge tone="success" pulse>
              {online} 个城市在线
            </StatusBadge>
            <StatusBadge tone="neutral">{REGIONS.length - online} 个城市规划中</StatusBadge>
          </div>
        </div>
        <div className="relative mx-auto max-w-6xl px-5 py-12">
          <div className="rounded-[28px] border bg-gradient-to-b from-card to-subtle/50 p-4 shadow-lg sm:p-8">
            <DotMap nodes={NODES} arcs={ARCS} />
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REGIONS.map((r) => (
            <div key={r.city} className="rounded-2xl border bg-card p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">{r.city}</div>
                  <div className="text-sm text-muted-foreground">
                    {r.country} · {r.region}
                  </div>
                </div>
                {r.status === "online" ? (
                  <StatusBadge tone="success" pulse>
                    在线
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">规划中</StatusBadge>
                )}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{r.note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
