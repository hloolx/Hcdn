import { Activity, Database, Gauge, Globe } from "lucide-react";
import { StatCard } from "@hcdn/ui/blocks/stat-card";
import { TimeSeriesChart } from "@hcdn/ui/charts/time-series";
import { ChartLegend } from "@hcdn/ui/charts/chart-kit";
import { BarList } from "@hcdn/ui/charts/bar-list";
import { LogoMark } from "@hcdn/ui/blocks/logo";
import { formatBytes } from "@hcdn/ui/lib/format";

// Static, illustrative numbers for the marketing screenshot-in-code.
const series = Array.from({ length: 24 }, (_, i) => {
  const h = (i + 8) % 24;
  const base = 0.45 + 0.4 * Math.exp(-Math.pow(h - 21, 2) / 10) + 0.2 * Math.exp(-Math.pow(h - 13, 2) / 8);
  const bytes = Math.round(base * 3.1e9 * (0.92 + ((i * 37) % 11) / 60));
  return { t: 1_760_000_400 + i * 3600, bytes, cachedBytes: Math.round(bytes * 0.86) };
});

export function ConsolePreview() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-lg ring-1 ring-black/[0.02]">
      <div className="flex items-center gap-2 border-b bg-subtle px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <div className="mx-auto flex h-6 w-72 items-center justify-center rounded-md border bg-background text-[11px] text-muted-foreground">
          console.hcdn.dev
        </div>
      </div>
      <div className="grid md:grid-cols-[180px_1fr]">
        <aside className="hidden border-r bg-sidebar p-3 md:block">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <LogoMark className="size-5" />
            <span className="text-sm font-semibold">Hcdn</span>
          </div>
          <div className="mt-3 space-y-0.5 text-[12.5px]">
            {["概览", "网站", "证书", "缓存", "统计分析", "访问日志"].map((l, i) => (
              <div key={l} className={i === 0 ? "rounded-md bg-sidebar-accent px-2.5 py-1.5 font-medium" : "px-2.5 py-1.5 text-muted-foreground"}>
                {l}
              </div>
            ))}
          </div>
        </aside>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="总流量" icon={<Activity />} value="74.6" unit="GB" delta={0.172} spark={series.map((s) => s.bytes)} className="p-3" />
            <StatCard label="请求数" icon={<Globe />} value="83.1万" delta={0.094} className="p-3" />
            <StatCard label="缓存命中率" icon={<Database />} value="86.4" unit="%" delta={0.021} className="p-3" />
            <StatCard label="峰值带宽" icon={<Gauge />} value="1.42" unit="Gbps" delta={0.11} className="p-3" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[13px] font-semibold">流量趋势</span>
                <ChartLegend
                  series={[
                    { key: "bytes", label: "总流量" },
                    { key: "cachedBytes", label: "缓存命中" },
                  ]}
                />
              </div>
              <TimeSeriesChart
                data={series}
                series={[
                  { key: "bytes", label: "总流量" },
                  { key: "cachedBytes", label: "缓存命中" },
                ]}
                height={170}
                formatValue={(v) => formatBytes(v)}
                unit="bytes"
              />
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="px-1 pb-2 text-[13px] font-semibold">访客地区</div>
              <BarList
                items={[
                  { key: "cn", label: "中国", value: 23.1e9 },
                  { key: "jp", label: "日本", value: 12.7e9 },
                  { key: "us", label: "美国", value: 10.4e9 },
                  { key: "hk", label: "中国香港", value: 6.6e9 },
                  { key: "sg", label: "新加坡", value: 5.2e9 },
                ]}
                formatValue={(v) => formatBytes(v)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
