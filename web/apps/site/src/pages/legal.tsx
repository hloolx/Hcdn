import { Link } from "react-router";
import { Button } from "@hcdn/ui/components/button";

const DOCS: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "服务条款",
    body: [
      "欢迎使用 Hcdn。注册或使用本服务即表示你同意本条款。",
      "你应确保接入的网站及内容合法合规，不得用于传播违法信息、侵犯他人权益、钓鱼、恶意软件分发或攻击他人系统。",
      "我们会尽力保障服务的可用性，但不对因不可抗力、上游网络故障或你方源站问题导致的中断承担责任。",
      "违反本条款或《可接受使用政策》的账号，我们有权暂停或终止服务。",
      "本条款的完整版本将在正式商用前发布，届时以控制台公示的版本为准。",
    ],
  },
  privacy: {
    title: "隐私政策",
    body: [
      "我们收集提供服务所必需的信息：账号信息（用户名、邮箱）、计费信息，以及边缘节点处理请求时产生的访问日志。",
      "访问日志用于统计、排障与安全防护，按套餐约定的期限保存，过期自动删除。",
      "我们不会出售你的个人信息。仅在法律要求或为保护服务安全时，才会依法向有关方面提供必要信息。",
      "你可以在控制台修改个人信息、删除 API 密钥，或联系我们注销账号。",
    ],
  },
  aup: {
    title: "可接受使用政策",
    body: [
      "禁止接入：违法违规内容、侵犯知识产权的内容、钓鱼与诈骗网站、恶意软件、赌博及色情内容。",
      "禁止利用本服务发起网络攻击、扫描或对第三方进行未经授权的访问。",
      "滥用投诉请发送至 abuse@hcdn.dev，我们会在核实后及时处理。",
    ],
  },
};

export function LegalPage({ kind }: { kind: keyof typeof DOCS }) {
  const doc = DOCS[kind]!;
  return (
    <div className="mx-auto max-w-3xl px-5 py-20">
      <h1 className="text-4xl font-semibold tracking-tight">{doc.title}</h1>
      <div className="mt-8 space-y-5 leading-[1.85] text-muted-foreground">
        {doc.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  );
}

export function SiteNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-32 text-center">
      <div className="text-gradient text-7xl font-semibold tracking-tight">404</div>
      <h1 className="mt-4 text-2xl font-semibold">页面不存在</h1>
      <p className="mt-2 text-muted-foreground">你访问的页面可能已被移动或删除。</p>
      <Button className="mt-8" asChild>
        <Link to="/">返回首页</Link>
      </Button>
    </div>
  );
}
