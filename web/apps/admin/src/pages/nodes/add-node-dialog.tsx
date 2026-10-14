import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KeyRound, TriangleAlert } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import type { CreatedNode } from "@hcdn/api/types";
import { Field } from "@hcdn/ui/blocks/field";
import { Button } from "@hcdn/ui/components/button";
import { Checkbox } from "@hcdn/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { Input } from "@hcdn/ui/components/input";
import { Textarea } from "@hcdn/ui/components/textarea";
import { api } from "@/lib/api";
import { toastError } from "@/lib/hooks";
import { isIP } from "@/lib/net";
import { ClusterSelect, useClusters } from "@/components/cluster-select";
import { CodeBlock } from "@/components/code-block";

const splitIps = (s: string) =>
  s
    .split(/[\s,，]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const schema = z.object({
  clusterId: z.string().min(1, "请选择集群"),
  name: z
    .string()
    .trim()
    .min(1, "请输入节点名称")
    .max(63, "名称最多 63 个字符")
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "只能包含字母、数字、点、下划线和连字符"),
  ips: z
    .string()
    .refine((s) => splitIps(s).length > 0, "请至少填写一个 IP 地址")
    .refine((s) => splitIps(s).every(isIP), "包含无效的 IP 地址"),
});
type FormValues = z.infer<typeof schema>;

export function AddNodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const clusters = useClusters();
  const [created, setCreated] = React.useState<CreatedNode | null>(null);
  const [saved, setSaved] = React.useState(false);
  const defaultCluster = String(clusters.data?.find((c) => c.isDefault)?.id ?? clusters.data?.[0]?.id ?? "");
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { clusterId: "", name: "", ips: "" } });

  React.useEffect(() => {
    if (open) {
      form.reset({ clusterId: defaultCluster, name: "", ips: "" });
      setCreated(null);
      setSaved(false);
    }
    // Only when the dialog opens; the default cluster may arrive later.
  }, [open]);
  React.useEffect(() => {
    if (open && !form.getValues("clusterId") && defaultCluster) form.setValue("clusterId", defaultCluster);
  }, [open, defaultCluster, form]);

  const create = useMutation({
    mutationFn: (v: FormValues) => api.createNode({ clusterId: Number(v.clusterId), name: v.name.trim(), ips: splitIps(v.ips) }),
    onSuccess: (res) => {
      setCreated(res);
      void qc.invalidateQueries({ queryKey: ["nodes"] });
      void qc.invalidateQueries({ queryKey: ["clusters"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        for (const [k, msg] of Object.entries(e.fields)) form.setError(k as keyof FormValues, { message: msg });
        return;
      }
      toastError(e, "添加节点失败");
    },
  });

  const { errors } = form.formState;
  const yaml = created
    ? [
        "rpc:",
        `  endpoints: [ ${created.install.endpoints.map((e) => `"${e}"`).join(", ")} ]`,
        `nodeId: "${created.install.nodeId}"`,
        `secret: "${created.install.secret}"`,
        "",
      ].join("\n")
    : "";

  return (
    <Dialog open={open} onOpenChange={(v) => (created && !saved ? undefined : onOpenChange(v))}>
      <DialogContent
        className={created ? "max-w-2xl" : "max-w-md"}
        showClose={!created || saved}
        onInteractOutside={(e) => created && e.preventDefault()}
        onEscapeKeyDown={(e) => created && !saved && e.preventDefault()}
      >
        {!created ? (
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="grid gap-5" noValidate>
            <DialogHeader>
              <DialogTitle>{t("添加节点")}</DialogTitle>
              <DialogDescription>{t("登记一台边缘服务器，创建后会生成该节点专用的安装凭据。")}</DialogDescription>
            </DialogHeader>
            <Field label={t("集群")} htmlFor="node-cluster" error={errors.clusterId?.message ? t(errors.clusterId.message) : undefined}>
              <Controller
                control={form.control}
                name="clusterId"
                render={({ field }) => <ClusterSelect id="node-cluster" value={field.value} onChange={field.onChange} invalid={!!errors.clusterId} />}
              />
            </Field>
            <Field
              label={t("节点名称")}
              htmlFor="node-name"
              error={errors.name?.message ? t(errors.name.message) : undefined}
              description={t("建议使用「地区-序号」，如 tyo-04")}
            >
              <Input id="node-name" placeholder="tyo-04" autoComplete="off" spellCheck={false} aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field
              label={t("IP 地址")}
              htmlFor="node-ips"
              error={errors.ips?.message ? t(errors.ips.message) : undefined}
              description={t("每行一个，支持 IPv4 与 IPv6。这些地址会被写入集群的 DNS 解析。")}
            >
              <Textarea
                id="node-ips"
                rows={3}
                placeholder={"203.0.113.20\n2001:db8::20"}
                className="font-mono text-[13px]"
                spellCheck={false}
                aria-invalid={!!errors.ips}
                {...form.register("ips")}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("取消")}
              </Button>
              <Button type="submit" loading={create.isPending}>
                {t("创建节点")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid min-w-0 gap-5">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-success-soft text-success-foreground">
                  <KeyRound className="size-4.5" />
                </span>
                <div className="space-y-1">
                  <DialogTitle>{t("节点 {{name}} 已创建", { name: created.node.name })}</DialogTitle>
                  <DialogDescription>{t("按下面的步骤在服务器上安装 edge-node 并接入集群。")}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div role="alert" className="flex gap-2.5 rounded-lg border border-warning/35 bg-warning-soft px-3.5 py-3 text-[13px] text-warning-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-semibold">{t("凭据只显示这一次")}</div>
                <div className="mt-0.5 leading-relaxed opacity-90">
                  {t("secret 等同于节点的登录密码，关闭后无法再次查看。请立即复制并妥善保存，不要提交到代码仓库或发到聊天工具中。")}
                </div>
              </div>
            </div>

            <ol className="grid min-w-0 gap-4">
              <Step n={1} title={t("下载并解压安装包")}>
                <p className="text-[13px] text-muted-foreground">{t("在服务器上下载与 API 节点版本一致的 edge-node 安装包，解压到安装目录：")}</p>
                <CodeBlock filename="shell" copyLabel={t("复制")} code={"unzip edge-node-linux-<架构>-v<版本>.zip -d /opt/hcdn"} />
              </Step>
              <Step n={2} title={t("写入节点凭据")}>
                <p className="text-[13px] text-muted-foreground">
                  {t("将以下内容保存为")} <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">/opt/hcdn/edge-node/configs/api_node.yaml</code>
                </p>
                <CodeBlock filename="configs/api_node.yaml" copyLabel={t("复制")} code={yaml} />
              </Step>
              <Step n={3} title={t("启动节点")}>
                <CodeBlock filename="shell" copyLabel={t("复制")} code={"/opt/hcdn/edge-node/bin/edge-node start"} />
              </Step>
              <Step n={4} title={t("确认上线")}>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {t("确保防火墙已放行 80 与 443 端口。约 1 分钟内节点会在列表中显示为「在线」，随后自动加入集群 DNS 解析。")}
                </p>
              </Step>
            </ol>

            <DialogFooter className="items-center sm:justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
                {t("我已保存节点凭据")}
              </label>
              <Button onClick={() => onOpenChange(false)} disabled={!saved}>
                {t("完成")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <span className="flex size-7 items-center justify-center rounded-full border bg-subtle text-xs font-semibold tabular">{n}</span>
      <div className="min-w-0 space-y-2 pt-1">
        <div className="text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  );
}
