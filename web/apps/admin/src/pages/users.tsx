import * as React from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe, KeyRound, MoreHorizontal, SearchX, Trash2, UserPlus, Users, Wand2 } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import type { AdminUser } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { Field } from "@hcdn/ui/blocks/field";
import { useConfirm } from "@hcdn/ui/blocks/confirm-dialog";
import { Avatar, AvatarFallback } from "@hcdn/ui/components/misc";
import { Button } from "@hcdn/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@hcdn/ui/components/dropdown-menu";
import { Input } from "@hcdn/ui/components/input";
import { PasswordInput, PasswordStrength } from "@hcdn/ui/components/password-input";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { Switch } from "@hcdn/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hcdn/ui/components/table";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { formatDate, formatRelative } from "@hcdn/ui/lib/format";
import { api } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { toastError, useUrlFilters } from "@/lib/hooks";
import { ClusterSelect, useClusters } from "@/components/cluster-select";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { TableCard } from "@/components/table-card";

const PAGE_SIZE = 20;

function initials(u: AdminUser) {
  const s = (u.fullname || u.username).trim();
  return /[一-龥]/.test(s[0] ?? "") ? s.slice(0, 1) : s.slice(0, 2).toUpperCase();
}

/** 16 chars from an unambiguous alphabet, via the platform CSPRNG. */
export function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join("");
}

export function UsersPage() {
  const { t } = useTranslation();
  const locale = currentLocale();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { values, page, set } = useUrlFilters(["keyword"] as const);
  const { confirm, dialog } = useConfirm();
  const [resetFor, setResetFor] = React.useState<AdminUser | null>(null);

  const createOpen = params.get("create") === "1";
  const setCreateOpen = (open: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set("create", "1");
        else next.delete("create");
        return next;
      },
      { replace: true },
    );

  const q = useQuery({
    queryKey: ["users", "list", values.keyword, page],
    queryFn: () => api.users({ keyword: values.keyword || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: ({ id, isOn }: { id: number; isOn: boolean }) => api.updateUser(id, { isOn }),
    onSuccess: (u) => {
      toast.success(u.isOn ? t("已启用用户 {{name}}", { name: u.username }) : t("已禁用用户 {{name}}", { name: u.username }));
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toastError(e, "操作失败"),
  });

  function onToggle(u: AdminUser, isOn: boolean) {
    if (isOn) return toggle.mutate({ id: u.id, isOn });
    confirm({
      title: t("禁用用户 {{name}}？", { name: u.username }),
      description: t("禁用后该用户无法登录控制台或调用 API，其网站会暂停加速。可随时重新启用。"),
      confirmText: t("禁用"),
      destructive: true,
      onConfirm: () => toggle.mutateAsync({ id: u.id, isOn: false }),
    });
  }

  function onDelete(u: AdminUser) {
    confirm({
      title: t("删除用户 {{name}}？", { name: u.username }),
      description: (
        <>
          {t("该用户的账号、API 密钥与访问日志将被永久删除。")}
          {u.sitesCount > 0 ? <strong className="mt-1 block font-medium text-destructive-foreground">{t("其名下的 {{n}} 个网站将同时下线并删除。", { n: u.sitesCount })}</strong> : null}
        </>
      ),
      confirmText: t("永久删除"),
      destructive: true,
      confirmPhrase: u.username,
      confirmPhraseLabel: (
        <>
          {t("请输入")} <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{u.username}</code> {t("以确认")}
        </>
      ),
      onConfirm: async () => {
        try {
          await api.deleteUser(u.id);
        } catch (e) {
          toastError(e, "删除失败");
          throw e;
        }
        toast.success(t("用户已删除"));
        void qc.invalidateQueries({ queryKey: ["users"] });
        void qc.invalidateQueries({ queryKey: ["sites"] });
      },
    });
  }

  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t("用户")}
        description={t("管理控制台账号：启用状态、所属集群与登录凭据。")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus />
            {t("创建用户")}
          </Button>
        }
      />
      <TableCard
        toolbar={
          <>
            <SearchInput value={values.keyword} onChange={(v) => set({ keyword: v })} placeholder={t("搜索用户名、姓名或邮箱")} />
            {q.data ? <span className="ml-auto text-[13px] text-muted-foreground tabular">{t("共 {{n}} 个用户", { n: q.data.total })}</span> : null}
          </>
        }
        footer={q.data && q.data.total > 0 ? <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => set({ page: p })} /> : null}
      >
        {q.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("用户列表加载失败")} />
        ) : items.length === 0 ? (
          values.keyword ? (
            <EmptyState
              icon={<SearchX />}
              title={t("没有匹配的用户")}
              description={t("换个关键词试试。")}
              action={
                <Button variant="outline" size="sm" onClick={() => set({ keyword: "" })}>
                  {t("清除搜索")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Users />}
              title={t("还没有用户")}
              description={t("开放注册后用户可自行注册，也可以在这里直接创建。")}
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <UserPlus />
                  {t("创建用户")}
                </Button>
              }
            />
          )
        ) : (
          <Table className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("用户")}</TableHead>
                <TableHead>{t("邮箱")}</TableHead>
                <TableHead>{t("状态")}</TableHead>
                <TableHead className="text-right">{t("网站")}</TableHead>
                <TableHead>{t("集群")}</TableHead>
                <TableHead>{t("注册时间")}</TableHead>
                <TableHead>{t("最近登录")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("操作")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id} className={cn(!u.isOn && "[&>td]:text-muted-foreground")}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className={cn("size-8", !u.isOn && "opacity-50 grayscale")}>
                        <AvatarFallback className="text-[11px]">{initials(u)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{u.username}</div>
                        <div className="max-w-48 truncate text-xs text-muted-foreground">{u.fullname || "—"}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px]">{u.email || "—"}</TableCell>
                  <TableCell>
                    <label className="flex w-fit cursor-pointer items-center gap-2">
                      <Switch
                        checked={u.isOn}
                        disabled={toggle.isPending && toggle.variables?.id === u.id}
                        onCheckedChange={(v) => onToggle(u, v)}
                        aria-label={u.isOn ? t("禁用") : t("启用")}
                      />
                      <span className={cn("text-[13px]", u.isOn ? "text-foreground" : "text-muted-foreground")}>{u.isOn ? t("正常") : t("已禁用")}</span>
                    </label>
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {u.sitesCount > 0 ? (
                      <Link to={`/sites?userId=${u.id}`} className="text-foreground hover:underline">
                        {u.sitesCount}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px]">{u.clusterName}</TableCell>
                  <TableCell className="text-[13px] tabular">{formatDate(u.createdAt, locale)}</TableCell>
                  <TableCell className="text-[13px] tabular">
                    {u.lastLoginAt ? <span title={formatDate(u.lastLoginAt, locale)}>{formatRelative(u.lastLoginAt, locale)}</span> : <span className="text-muted-foreground">{t("从未登录")}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t("更多操作")}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem asChild>
                          <Link to={`/sites?userId=${u.id}`}>
                            <Globe />
                            {t("查看网站")}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResetFor(u)}>
                          <KeyRound />
                          {t("重置密码")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onDelete(u)} className="text-destructive-foreground focus:text-destructive-foreground [&_svg]:!text-destructive-foreground">
                          <Trash2 />
                          {t("删除用户")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
      {dialog}
    </div>
  );
}

const passwordRule = z.string().min(8, "密码至少 8 位").max(128, "密码最多 128 位");

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "只能包含字母、数字、点、下划线和连字符"),
  fullname: z.string().trim().max(50, "最多 50 个字符"),
  email: z.union([z.literal(""), z.string().trim().email("邮箱格式不正确")]),
  password: passwordRule,
  clusterId: z.string().min(1, "请选择集群"),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const clusters = useClusters();
  const defaultCluster = String(clusters.data?.find((c) => c.isDefault)?.id ?? clusters.data?.[0]?.id ?? "");
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { username: "", fullname: "", email: "", password: "", clusterId: "" },
  });
  React.useEffect(() => {
    if (open) form.reset({ username: "", fullname: "", email: "", password: "", clusterId: defaultCluster });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (open && !form.getValues("clusterId") && defaultCluster) form.setValue("clusterId", defaultCluster);
  }, [open, defaultCluster, form]);

  const create = useMutation({
    mutationFn: (v: CreateValues) =>
      api.createUser({ username: v.username.trim(), password: v.password, email: v.email || undefined, fullname: v.fullname || undefined, clusterId: Number(v.clusterId) }),
    onSuccess: (u) => {
      toast.success(t("用户 {{name}} 已创建", { name: u.username }));
      void qc.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        for (const [k, msg] of Object.entries(e.fields)) form.setError(k as keyof CreateValues, { message: msg });
        return;
      }
      toastError(e, "创建用户失败");
    },
  });
  const { errors } = form.formState;
  const err = (m?: string) => (m ? t(m) : undefined);
  const password = form.watch("password");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t("创建用户")}</DialogTitle>
            <DialogDescription>{t("创建后用户即可使用用户名和密码登录控制台。")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("用户名")} htmlFor="u-username" required error={err(errors.username?.message)}>
              <Input id="u-username" autoComplete="off" spellCheck={false} aria-invalid={!!errors.username} {...form.register("username")} />
            </Field>
            <Field label={t("姓名 / 公司")} htmlFor="u-fullname" error={err(errors.fullname?.message)}>
              <Input id="u-fullname" autoComplete="off" {...form.register("fullname")} />
            </Field>
          </div>
          <Field label={t("邮箱")} htmlFor="u-email" error={err(errors.email?.message)}>
            <Input id="u-email" type="email" autoComplete="off" placeholder="name@example.com" aria-invalid={!!errors.email} {...form.register("email")} />
          </Field>
          <Field
            label={t("初始密码")}
            htmlFor="u-password"
            required
            error={err(errors.password?.message)}
            aside={
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                onClick={() => form.setValue("password", generatePassword(), { shouldValidate: true })}
              >
                <Wand2 className="size-3.5" />
                {t("生成强密码")}
              </button>
            }
          >
            <PasswordInput id="u-password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
            {password ? <PasswordStrength value={password} /> : null}
          </Field>
          <Field label={t("所属集群")} htmlFor="u-cluster" required error={err(errors.clusterId?.message)} description={t("用户新建的网站将部署到该集群。")}>
            <Controller control={form.control} name="clusterId" render={({ field }) => <ClusterSelect id="u-cluster" value={field.value} onChange={field.onChange} invalid={!!errors.clusterId} />} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t("创建用户")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (user) {
      setPassword("");
      setError(null);
    }
  }, [user]);
  const reset = useMutation({
    mutationFn: () => api.resetUserPassword(user!.id, password),
    onSuccess: () => {
      toast.success(t("已重置 {{name}} 的密码", { name: user?.username ?? "" }), { description: t("请通过安全渠道将新密码告知用户。") });
      onClose();
    },
    onError: (e) => toastError(e, "重置密码失败"),
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = passwordRule.safeParse(password);
    if (!r.success) return setError(t(r.error.issues[0]?.message ?? "密码无效"));
    setError(null);
    reset.mutate();
  }
  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t("重置密码")}</DialogTitle>
            <DialogDescription>
              {t("为用户 {{name}} 设置新密码，其现有的登录会话将全部失效。", { name: user?.username ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <Field
            label={t("新密码")}
            htmlFor="reset-password"
            error={error}
            aside={
              <button type="button" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setPassword(generatePassword())}>
                <Wand2 className="size-3.5" />
                {t("生成强密码")}
              </button>
            }
          >
            <PasswordInput id="reset-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus aria-invalid={!!error} />
            {password ? <PasswordStrength value={password} /> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={reset.isPending}>
              {t("重置密码")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
