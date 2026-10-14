import type { DotMapNode, DotMapArc } from "@hcdn/ui/charts/dot-map";

export const NODES: DotMapNode[] = [
  { id: "tyo", label: "东京", lon: 139.69, lat: 35.69, status: "online" },
  { id: "lax", label: "洛杉矶", lon: -118.24, lat: 34.05, status: "online" },
  { id: "hkg", label: "香港", lon: 114.17, lat: 22.32, status: "planned" },
  { id: "sin", label: "新加坡", lon: 103.82, lat: 1.35, status: "planned" },
  { id: "icn", label: "首尔", lon: 126.98, lat: 37.57, status: "planned" },
  { id: "tpe", label: "台北", lon: 121.56, lat: 25.04, status: "planned" },
];

/** Illustrative visitor → nearest node paths. */
export const ARCS: DotMapArc[] = [
  { from: [121.47, 31.23], to: "tyo" }, // Shanghai
  { from: [113.26, 23.13], to: "tyo" }, // Guangzhou
  { from: [116.4, 39.9], to: "tyo" }, // Beijing
  { from: [126.98, 37.57], to: "tyo" }, // Seoul
  { from: [151.21, -33.87], to: "tyo" }, // Sydney
  { from: [100.5, 13.75], to: "tyo" }, // Bangkok
  { from: [106.85, -6.2], to: "tyo" }, // Jakarta
  { from: [-122.42, 37.77], to: "lax" }, // San Francisco
  { from: [-87.63, 41.88], to: "lax" }, // Chicago
  { from: [-99.13, 19.43], to: "lax" }, // Mexico City
  { from: [-123.12, 49.28], to: "lax" }, // Vancouver
  { from: [-157.86, 21.31], to: "lax" }, // Honolulu
];

export interface SitePlan {
  id: string;
  name: string;
  tagline: string;
  monthly: number | null;
  yearly: number | null;
  cta: string;
  highlight?: boolean;
  features: string[];
}

export const PLANS: SitePlan[] = [
  {
    id: "free",
    name: "免费版",
    tagline: "个人项目与体验",
    monthly: 0,
    yearly: 0,
    cta: "免费开始",
    features: ["每月 50 GB 流量", "1 个网站（最多 3 个域名）", "自动 HTTPS 证书", "基础缓存规则", "24 小时统计"],
  },
  {
    id: "pro",
    name: "专业版",
    tagline: "出海网站与电商",
    monthly: 99,
    yearly: 950,
    cta: "开始 14 天试用",
    highlight: true,
    features: ["每月 1 TB 流量", "20 个网站", "WAF、IP 黑白名单、地区封禁", "按 IP 限速", "30 天统计与访问日志", "API 访问", "工单支持"],
  },
  {
    id: "business",
    name: "企业版",
    tagline: "高并发与定制需求",
    monthly: null,
    yearly: null,
    cta: "联系我们",
    features: ["按需定制流量包", "不限网站数", "专属节点组与 IP 隔离", "自定义防护策略", "日志导出", "SLA 与专属技术支持"],
  },
];

export const FAQS: { q: string; a: string }[] = [
  { q: "使用 Hcdn 需要备案吗？", a: "不需要。Hcdn 的边缘节点位于中国大陆以外，接入无需 ICP 备案。请确保网站内容遵守节点所在地及访客所在地的法律法规。" },
  { q: "如何接入？需要迁移 DNS 吗？", a: "不需要迁移 DNS。在控制台添加网站并填写源站地址后，你会得到一个 CNAME 记录值，只要在现有 DNS 服务商处把域名的 CNAME 指向它即可，通常几分钟内生效。" },
  { q: "HTTPS 证书怎么处理？", a: "可以一键申请免费证书（自动续期），也可以上传自有证书。支持 HTTP/2、TLS 1.3 和强制跳转 HTTPS。" },
  { q: "源站在中国大陆可以吗？", a: "可以。边缘节点会从你的源站回源，源站位置不限；对于大陆源站，建议开启缓存以减少跨境回源。" },
  { q: "如何计费？", a: "按套餐计费，套餐内包含流量额度和网站数量。超出部分可按量付费或升级套餐。企业客户可定制流量包与独享节点。" },
  { q: "能拿到访客的真实 IP 吗？", a: "能。边缘节点把访客 IP 通过 X-Forwarded-For / X-Real-IP 请求头传给源站，你的访问日志和防护规则都基于真实 IP。" },
];
