import * as React from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Cloud, Globe, Lock, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import type { DnsDomain, DnsProvider } from "@hcdn/api/types";
import { PageHeader, Section } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { StatusBadge } from "@hcdn/ui/blocks/status";
import { Field } from "@hcdn/ui/blocks/field";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { Button } from "@hcdn/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hcdn/ui/components/dropdown-menu";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput } from "@hcdn/ui/components/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { toast } from "@hcdn/ui/components/toaster";
import { formatDate, formatDateTime, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { toastError } from "@/lib/hooks";
import { isHostname } from "@/lib/net";
import { TableCard } from "@/components/table-card";

function CloudflareMark({ className }: { className?: string }) {
  return (
    <span className={"flex size-9 shrink-0 items-center justify-center rounded-lg border bg-[oklch(0.97_0.03_60)] text-[oklch(0.68_0.18_50)] dark:bg-[oklch(0.3_0.06_55/0.5)] dark:text-[oklch(0.8_0.14_60)] " + (className ?? "")}>
      <Cloud className="size-4.5" fill="currentColor" strokeWidth={1.5} />
    </span>
  );
}

export function DnsPage() {
  const { t } = useTranslation();
  const [addProvider, setAddProvider] = React.useState(false);
  const [addDomain, setAddDomain] = React.useState(false);
  const providers = useQuery({ queryKey: ["dns", "providers"], queryFn: api.dnsProviders });
  const domains = useQuery({ queryKey: ["dns", "domains"], queryFn: api.dnsDomains });

  return (
    <div className="space-y-10">
      <PageHeader className="pb-0" title="DNS" description={t("连接 DNS 服务商后，集群节点的解析记录会自动维护：节点上线时添加，离线或停用时摘除。")} />

      <Section
        title={t("服务商")}
        description={t("用于托管 CDN 解析域名的 DNS 服务商账号")}
        actions={
          <Button variant="outline" onClick={() => setAddProvider(true)}>
            <Plus />
            {t("添加 Cloudflare")}
          </Button>
        }
      >
        <ProvidersList q={providers} onAdd={() => setAddProvider(true)} />
      </Section>

      <Section
        title={t("域名")}
        description={t("集群可绑定的解析域名；同步会从服务商拉取最新的记录")}
        actions={
          <Button variant="outline" onClick={() => setAddDomain(true)} disabled={!providers.data?.length}>
            <Plus />
            {t("添加域名")}
          </Button>
        }
      >
        <DomainsTable q={domains} hasProvider={!!providers.data?.length} onAdd={() => setAddDomain(true)} />
      </Section>

      <AddProviderDialog open={addProvider} onOpenChange={setAddProvider} />
      <AddDomainDialog open={addDomain} onOpenChange={setAddDomain} providers={providers.data ?? []} />
    </div>
  );
}

function ProvidersList({ q, onAdd }: { q: UseQueryResult<DnsProvider[]>; onAdd: () => void }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();

  function onDelete(p: DnsProvider) {
    confirm({
      title: t("删除服务商 {{name}}？", { name: p.name }),
      description: t("保存的 API Token 会被立即删除。该服务商下仍有域名时无法删除。"),
      confirmText: t("删除"),
      destructive: true,
      onConfirm: async () => {
        try {
          await api.deleteDnsProvider(p.id);
        } catch (e) {
          toastError(e, "删除失败");
          throw e;
        }
        toast.success(t("服务商已删除"));
        void qc.invalidateQueries({ queryKey: ["dns"] });
      },
    });
  }

  if (q.isPending) return <Skeleton className="h-[74px] rounded-xl" />;
  if (q.isError) return <ErrorState className="rounded-xl border bg-card" error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("服务商加载失败")} />;
  if (q.data.length === 0)
    return (
      <div className="rounded-xl border border-dashed bg-card">
        <EmptyState
          compact
          icon={<Cloud />}
          title={t("还没有连接 DNS 服务商")}
          description={t("连接 Cloudflare 账号后，即可为集群绑定解析域名。")}
          action={
            <Button size="sm" onClick={onAdd}>
              <Plus />
              {t("添加 Cloudflare")}
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {q.data.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
          <CloudflareMark />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <StatusBadge tone="success">{t("已连接")}</StatusBadge>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Cloudflare · {t("{{n}} 个域名", { n: p.domainsCount })} · {t("添加于 {{d}}", { d: formatDate(p.createdAt, locale) })}
            </div>
          </div>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex" title={t("API Token 已加密保存，不会再次显示")}>
            <Lock className="size-3.5" />
            Token
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("更多操作")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onDelete(p)} className="text-destructive-foreground focus:text-destructive-foreground [&_svg]:!text-destructive-foreground">
                <Trash2 />
                {t("删除服务商")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {dialog}
    </div>
  );
}

function DomainsTable({ q, hasProvider, onAdd }: { q: UseQueryResult<DnsDomain[]>; hasProvider: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: (id: number) => api.syncDnsDomain(id),
    onSuccess: (d) => {
      toast.success(t("{{name}} 已同步", { name: d.name }), { description: t("共 {{n}} 条解析记录", { n: d.recordsCount }) });
      void qc.invalidateQueries({ queryKey: ["dns", "domains"] });
    },
    onError: (e) => toastError(e, "同步失败"),
  });

  return (
    <TableCard>
      {q.isPending ? (
        <div className="space-y-2 p-5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("域名加载失败")} />
      ) : q.data.length === 0 ? (
        <EmptyState
          compact
          icon={<Globe />}
          title={t("还没有域名")}
          description={hasProvider ? t("添加一个托管在服务商中的域名，用于集群解析。") : t("请先连接 DNS 服务商。")}
          action={
            hasProvider ? (
              <Button size="sm" onClick={onAdd}>
                <Plus />
                {t("添加域名")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("域名")}</TableHead>
              <TableHead>{t("服务商")}</TableHead>
              <TableHead>{t("状态")}</TableHead>
              <TableHead className="text-right">{t("记录数")}</TableHead>
              <TableHead>{t("上次同步")}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{t("操作")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((d) => {
              const busy = sync.isPending && sync.variables === d.id;
              const stale = d.syncedAt == null || Date.now() / 1000 - d.syncedAt > 86400;
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-[13px] font-medium">{d.name}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{d.providerName}</TableCell>
                  <TableCell>{d.isOn ? <StatusBadge tone="success">{t("启用")}</StatusBadge> : <StatusBadge>{t("已停用")}</StatusBadge>}</TableCell>
                  <TableCell className="text-right text-[13px] tabular">{d.recordsCount}</TableCell>
                  <TableCell className={stale ? "text-[13px] text-warning-foreground" : "text-[13px] text-muted-foreground"}>
                    <span title={formatDateTime(d.syncedAt, locale)}>{d.syncedAt ? formatRelative(d.syncedAt, locale) : t("从未同步")}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => sync.mutate(d.id)} disabled={busy}>
                      <RefreshCw className={busy ? "animate-spin" : undefined} />
                      {busy ? t("同步中…") : t("同步")}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

function AddProviderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [token, setToken] = React.useState("");
  const [errors, setErrors] = React.useState<{ name?: string; apiToken?: string }>({});
  React.useEffect(() => {
    if (open) {
      setName("Cloudflare");
      setToken("");
      setErrors({});
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => api.createDnsProvider({ name: name.trim(), type: "cloudflare", apiToken: token.trim() }),
    onSuccess: () => {
      toast.success(t("已连接 Cloudflare"), { description: t("API Token 已加密保存。") });
      void qc.invalidateQueries({ queryKey: ["dns"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) return setErrors({ name: e.fields.name, apiToken: e.fields.apiToken ?? e.message });
      toastError(e, "添加失败");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = t("请输入名称");
    if (!token.trim()) next.apiToken = t("请输入 API Token");
    else if (/\s/.test(token.trim())) next.apiToken = t("Token 中不应包含空格");
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  }

  const steps = [
    t("登录 Cloudflare 控制台，进入「我的个人资料 → API 令牌」，点击「创建令牌」。"),
    t("选择「创建自定义令牌」，权限只添加一条：区域 (Zone) → DNS → 编辑 (Edit)。"),
    t("区域资源选择「包括 → 特定区域」，只勾选用于 CDN 解析的域名。"),
    t("创建后复制令牌，粘贴到下方。"),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById("cf-token")?.focus();
        }}
      >
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <CloudflareMark />
              <div className="space-y-1">
                <DialogTitle>{t("添加 Cloudflare")}</DialogTitle>
                <DialogDescription>{t("使用仅限 DNS 编辑权限的 API Token 连接。")}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="rounded-lg border bg-subtle p-4">
            <div className="flex items-center gap-1.5 text-[13px] font-medium">
              <ShieldCheck className="size-4 text-success" />
              {t("如何创建最小权限的 Token")}
            </div>
            <ol className="mt-2.5 space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-background text-[10.5px] font-semibold text-foreground tabular">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 border-t pt-2.5 text-[12px] text-muted-foreground">{t("请勿使用 Global API Key：它拥有账号的全部权限。")}</p>
          </div>

          <Field label={t("名称")} htmlFor="cf-name" error={errors.name} description={t("便于区分多个账号，如「Cloudflare 主账号」")}>
            <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
          </Field>
          <Field label="API Token" htmlFor="cf-token" error={errors.apiToken}>
            <PasswordInput
              id="cf-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!errors.apiToken}
            />
          </Field>
          <p className="-mt-2 flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {t("保存时会先向 Cloudflare 校验该 Token。Token 加密存储，保存后不会再次显示。")}
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {create.isPending ? t("正在校验…") : t("校验并保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddDomainDialog({ open, onOpenChange, providers }: { open: boolean; onOpenChange: (v: boolean) => void; providers: DnsProvider[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [providerId, setProviderId] = React.useState("");
  const [name, setName] = React.useState("");
  const [errors, setErrors] = React.useState<{ providerId?: string; name?: string }>({});
  React.useEffect(() => {
    if (open) {
      setProviderId(providers.length === 1 ? String(providers[0]!.id) : "");
      setName("");
      setErrors({});
    }
  }, [open, providers]);

  const create = useMutation({
    mutationFn: () => api.createDnsDomain({ providerId: Number(providerId), name: name.trim().toLowerCase().replace(/\.$/, "") }),
    onSuccess: (d) => {
      toast.success(t("已添加域名 {{name}}", { name: d.name }));
      void qc.invalidateQueries({ queryKey: ["dns"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields.name) return setErrors({ name: t(e.fields.name) });
      toastError(e, "添加失败");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!providerId) next.providerId = t("请选择服务商");
    const n = name.trim().toLowerCase().replace(/\.$/, "");
    if (!n) next.name = t("请输入域名");
    else if (!isHostname(n)) next.name = t("域名格式不正确");
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t("添加域名")}</DialogTitle>
            <DialogDescription>{t("域名必须已托管在所选服务商账号下，且 Token 拥有该区域的 DNS 编辑权限。")}</DialogDescription>
          </DialogHeader>
          <Field label={t("服务商")} htmlFor="d-provider" error={errors.providerId}>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger id="d-provider" className="w-full" aria-invalid={!!errors.providerId}>
                <SelectValue placeholder={t("选择服务商")} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("域名")} htmlFor="d-name" error={errors.name} description={t("填写根域名（区域），如 example.com")}>
            <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" className="font-mono" spellCheck={false} autoComplete="off" aria-invalid={!!errors.name} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t("添加")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
