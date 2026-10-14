import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, KeyRound, Plus, Trash2 } from "lucide-react";
import type { AccessKey, CreatedAccessKey } from "@hcdn/api/types";
import { errorMessage } from "@hcdn/api/client";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { Field } from "@hcdn/ui/blocks/field";
import { EmptyState, ErrorState, ListSkeleton } from "@hcdn/ui/blocks/states";
import { CopyButton, CopyField } from "@hcdn/ui/blocks/status";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { Button } from "@hcdn/ui/components/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@hcdn/ui/components/card";
import { Checkbox } from "@hcdn/ui/components/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { Input } from "@hcdn/ui/components/input";
import { Switch } from "@hcdn/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { toast } from "@hcdn/ui/components/toaster";
import { Hint } from "@hcdn/ui/components/tooltip";
import { cn } from "@hcdn/ui/lib/cn";
import { formatDate, formatDateTime, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { AccountTabs } from "./tabs";

const MAX_KEYS = 10;

export function AccessKeysPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access-keys"], queryFn: api.accessKeys });
  const [creating, setCreating] = React.useState(false);
  const { confirm, dialog } = useConfirm();
  const keys = q.data ?? [];

  const toggle = useMutation({
    mutationFn: (k: AccessKey) => api.updateAccessKey(k.id, !k.isOn),
    onMutate: async (k) => {
      await qc.cancelQueries({ queryKey: ["access-keys"] });
      const prev = qc.getQueryData<AccessKey[]>(["access-keys"]);
      qc.setQueryData<AccessKey[]>(["access-keys"], (list) => list?.map((x) => (x.id === k.id ? { ...x, isOn: !k.isOn } : x)));
      return { prev };
    },
    onError: (e, _k, ctx) => {
      if (ctx?.prev) qc.setQueryData(["access-keys"], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (k) => toast.success(k.isOn ? t("密钥已启用") : t("密钥已停用，使用它的请求将被拒绝")),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["access-keys"] }),
  });

  const remove = useMutation({
    mutationFn: (k: AccessKey) => api.deleteAccessKey(k.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["access-keys"] });
      void qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success(t("密钥已删除"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function askDelete(k: AccessKey) {
    confirm({
      title: t("删除 API 密钥？"),
      description: (
        <>
          {t("删除后，使用")} <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{k.accessKeyId}</code> {t("的脚本和集成将立即失效，且无法恢复。如只是暂时不用，可以改为停用。")}
        </>
      ),
      confirmText: t("删除密钥"),
      cancelText: t("取消"),
      destructive: true,
      onConfirm: () => remove.mutateAsync(k),
    });
  }

  return (
    <div>
      <PageHeader title={t("账号设置")} description={t("管理个人资料、登录密码与套餐。")} />
      <AccountTabs />
      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>{t("API 密钥")}</CardTitle>
          <CardDescription>{t("用于通过开放 API 管理网站、刷新缓存等。密钥拥有与你的账号相同的权限，请妥善保管，不要提交到代码仓库。")}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setCreating(true)} disabled={keys.length >= MAX_KEYS || q.isPending}>
              <Plus />
              {t("创建密钥")}
            </Button>
          </CardAction>
        </CardHeader>
        {q.error && !q.data ? (
          <ErrorState title={t("密钥列表加载失败")} error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} />
        ) : q.isPending ? (
          <ListSkeleton rows={3} />
        ) : keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            title={t("还没有 API 密钥")}
            description={t("创建密钥后，即可在 CI 流水线或脚本中自动刷新缓存、管理网站。")}
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {t("创建密钥")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>AccessKey ID</TableHead>
                    <TableHead>{t("描述")}</TableHead>
                    <TableHead>{t("创建时间")}</TableHead>
                    <TableHead>{t("最后使用")}</TableHead>
                    <TableHead>{t("状态")}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{t("操作")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id} className={cn(!k.isOn && "text-muted-foreground")}>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <span className="font-mono text-[12.5px]">{k.accessKeyId}</span>
                          <CopyButton value={k.accessKeyId} successText={t("已复制")} />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-[13px]">{k.description || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-[13px] tabular">{formatDate(k.createdAt, locale)}</TableCell>
                      <TableCell className="text-[13px]" title={k.lastUsedAt ? formatDateTime(k.lastUsedAt, locale) : undefined}>
                        {k.lastUsedAt ? formatRelative(k.lastUsedAt, locale) : <span className="text-muted-foreground">{t("从未使用")}</span>}
                      </TableCell>
                      <TableCell>
                        <label className="inline-flex items-center gap-2 text-[13px]">
                          <Switch checked={k.isOn} onCheckedChange={() => toggle.mutate(k)} aria-label={t("启用密钥 {{id}}", { id: k.accessKeyId })} />
                          {k.isOn ? t("启用") : t("停用")}
                        </label>
                      </TableCell>
                      <TableCell className="pl-0">
                        <Hint label={t("删除")}>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive-foreground" onClick={() => askDelete(k)} aria-label={t("删除密钥 {{id}}", { id: k.accessKeyId })}>
                            <Trash2 />
                          </Button>
                        </Hint>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {keys.map((k) => (
                <li key={k.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[12.5px]">{k.accessKeyId}</span>
                    <Switch checked={k.isOn} onCheckedChange={() => toggle.mutate(k)} aria-label={t("启用密钥 {{id}}", { id: k.accessKeyId })} />
                  </div>
                  <div className="text-[13px]">{k.description || "—"}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{k.lastUsedAt ? t("{{time}}使用过", { time: formatRelative(k.lastUsedAt, locale) }) : t("从未使用")}</span>
                    <Button variant="ghost" size="sm" className="h-7 text-destructive-foreground" onClick={() => askDelete(k)}>
                      <Trash2 />
                      {t("删除")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t px-5 py-3 text-xs text-muted-foreground tabular">{t("已创建 {{n}}/{{max}} 个密钥", { n: keys.length, max: MAX_KEYS })}</div>
          </>
        )}
      </Card>
      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
      {dialog}
    </div>
  );
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [description, setDescription] = React.useState("");
  const [created, setCreated] = React.useState<CreatedAccessKey | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      // Drop the secret from memory as soon as the dialog closes.
      setDescription("");
      setCreated(null);
      setSaved(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.createAccessKey(description.trim()),
    onSuccess: (res) => {
      setCreated(res);
      void qc.invalidateQueries({ queryKey: ["access-keys"] });
      void qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const tooLong = description.trim().length > 50;

  return (
    <Dialog open={open} onOpenChange={(o) => (created && !saved ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-lg" showClose={!created || saved} onEscapeKeyDown={(e) => created && !saved && e.preventDefault()} onPointerDownOutside={(e) => created && e.preventDefault()}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("密钥已创建")}</DialogTitle>
              <DialogDescription>{t("请立即复制并保存 Secret。")}</DialogDescription>
            </DialogHeader>
            <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <div className="space-y-0.5">
                <div className="font-medium text-warning-foreground">{t("Secret 只会显示这一次")}</div>
                <div className="text-muted-foreground">{t("关闭对话框后将无法再次查看。如果遗失，只能删除该密钥并重新创建。")}</div>
              </div>
            </div>
            <div className="grid gap-4">
              <Field label="AccessKey ID">
                <CopyField value={created.key.accessKeyId} />
              </Field>
              <Field label="AccessKey Secret">
                <CopyField value={created.secret} className="border-warning/40" />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-[13px]">
              <Checkbox checked={saved} onCheckedChange={(c) => setSaved(c === true)} />
              {t("我已将 Secret 保存在安全的位置")}
            </label>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} disabled={!saved}>
                {t("完成")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tooLong) mutation.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("创建 API 密钥")}</DialogTitle>
              <DialogDescription>{t("为密钥写一个描述，方便日后识别它的用途。")}</DialogDescription>
            </DialogHeader>
            <Field label={t("描述")} htmlFor="key-desc" error={tooLong ? t("描述最多 50 个字符") : undefined} description={t("例如：CI 刷新缓存、监控脚本。")}>
              <Input id="key-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("用途说明")} autoFocus aria-invalid={tooLong} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("取消")}
              </Button>
              <Button type="submit" loading={mutation.isPending} disabled={tooLong}>
                {t("创建")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
