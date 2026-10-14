import * as React from "react";
import { Link } from "react-router";
import { Check, Minus } from "lucide-react";
import { Button } from "@hcdn/ui/components/button";
import { Segmented } from "@hcdn/ui/blocks/segmented";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@hcdn/ui/components/accordion";
import { cn } from "@hcdn/ui/lib/cn";
import { FAQS, PLANS } from "@/lib/site-data";
import { REGISTER_URL } from "@/lib/links";

type Cell = boolean | string;
const MATRIX: { group: string; rows: { label: string; values: [Cell, Cell, Cell] }[] }[] = [
  {
    group: "加速",
    rows: [
      { label: "每月流量", values: ["50 GB", "1 TB", "按需定制"] },
      { label: "网站数量", values: ["1", "20", "不限"] },
      { label: "边缘节点", values: ["共享", "共享", "专属节点组"] },
      { label: "HTTP/2 · TLS 1.3", values: [true, true, true] },
      { label: "Gzip / Brotli 压缩", values: [true, true, true] },
    ],
  },
  {
    group: "证书与缓存",
    rows: [
      { label: "免费证书自动续期", values: [true, true, true] },
      { label: "上传自有证书", values: [false, true, true] },
      { label: "自定义缓存规则", values: ["3 条", "不限", "不限"] },
      { label: "刷新 / 预热（每日）", values: ["100 条", "5,000 条", "定制"] },
    ],
  },
  {
    group: "安全",
    rows: [
      { label: "WAF 规则防护", values: [false, true, true] },
      { label: "IP 黑白名单", values: [true, true, true] },
      { label: "地区封禁", values: [false, true, true] },
      { label: "按 IP 限速", values: [false, true, true] },
    ],
  },
  {
    group: "数据与支持",
    rows: [
      { label: "统计数据保留", values: ["24 小时", "30 天", "180 天"] },
      { label: "访问日志", values: [false, "7 天", "30 天 + 导出"] },
      { label: "API 访问", values: [false, true, true] },
      { label: "技术支持", values: ["社区", "工单", "专属支持 + SLA"] },
    ],
  },
];

function CellView({ v }: { v: Cell }) {
  if (v === true) return <Check className="mx-auto size-4 text-success" />;
  if (v === false) return <Minus className="mx-auto size-4 text-muted-foreground/50" />;
  return <span className="text-sm">{v}</span>;
}

export function PricingPage() {
  const [period, setPeriod] = React.useState<"monthly" | "yearly">("monthly");
  return (
    <div>
      <section className="relative overflow-hidden border-b">
        <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_60%_70%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">选择适合你的套餐</h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">所有套餐都包含边缘加速、自动 HTTPS 与实时统计。按年付费可享约 8 折。</p>
          <Segmented
            className="mt-8"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "monthly", label: "按月付费" },
              { value: "yearly", label: "按年付费 · 省 20%" },
            ]}
          />
          <div className="mx-auto mt-12 grid max-w-5xl gap-5 text-left md:grid-cols-3">
            {PLANS.map((p) => {
              const price = period === "monthly" ? p.monthly : p.yearly == null ? null : Math.round(p.yearly / 12);
              return (
                <div key={p.id} className={cn("relative flex flex-col rounded-2xl border bg-card p-7 shadow-xs", p.highlight && "border-primary/40 shadow-glow")}>
                  {p.highlight ? <span className="absolute -top-3 left-7 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">最受欢迎</span> : null}
                  <div className="text-lg font-semibold">{p.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{p.tagline}</div>
                  <div className="mt-6 flex h-14 items-end gap-1 [&>*]:leading-none">
                    {price == null ? (
                      <span className="text-4xl font-semibold tracking-tight">定制</span>
                    ) : (
                      <>
                        <span className="text-lg font-medium text-muted-foreground">¥</span>
                        <span className="text-5xl font-semibold tracking-tight">{price}</span>
                        <span className="text-sm text-muted-foreground">/ 月</span>
                      </>
                    )}
                  </div>
                  <div className="mt-1 h-5 text-xs text-muted-foreground">{period === "yearly" && p.yearly ? `按年付费 ¥${p.yearly}` : ""}</div>
                  <Button className="mt-6" size="lg" variant={p.highlight ? "default" : "outline"} asChild>
                    {p.monthly == null ? <a href="mailto:sales@hcdn.dev">{p.cta}</a> : <a href={REGISTER_URL}>{p.cta}</a>}
                  </Button>
                  <ul className="mt-7 space-y-3 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">价格为示例套餐，正式价格以控制台为准。</p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight">完整功能对比</h2>
        <div className="mt-10 overflow-x-auto rounded-2xl border bg-card shadow-xs">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-subtle/60">
                <th className="w-2/5 px-5 py-4 text-left font-medium text-muted-foreground">功能</th>
                {PLANS.map((p) => (
                  <th key={p.id} className={cn("px-5 py-4 text-center font-semibold", p.highlight && "text-primary")}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((g) => (
                <React.Fragment key={g.group}>
                  <tr className="border-b bg-subtle/30">
                    <td colSpan={4} className="px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground">
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-b last:border-0">
                      <td className="px-5 py-3.5">{r.label}</td>
                      {r.values.map((v, i) => (
                        <td key={i} className="px-5 py-3.5 text-center">
                          <CellView v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t bg-subtle/40 py-20">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="text-center text-2xl font-semibold tracking-tight">关于计费</h2>
          <Accordion type="single" collapsible className="mt-8 rounded-2xl border bg-card px-6 shadow-xs">
            {FAQS.filter((f) => /计费|接入|证书/.test(f.q)).map((f, i) => (
              <AccordionItem key={i} value={`p${i}`}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            需要更大的流量包或专属节点？<Link to="/docs" className="text-primary hover:underline">查看文档</Link> 或发邮件至 sales@hcdn.dev。
          </p>
        </div>
      </section>
    </div>
  );
}
