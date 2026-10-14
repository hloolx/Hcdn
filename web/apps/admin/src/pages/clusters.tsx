import * as React from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Boxes, Globe, MoreHorizontal, Pencil, Plus, Server, TriangleAlert, Waypoints } from "lucide-react";
import { ApiError } from "@hcdn/api/client";
import type { Cluster } from "@hcdn/api/types";
import { PageHeader } from "@hcdn/ui/blocks/page-header";
import { EmptyState, ErrorState } from "@hcdn/ui/blocks/states";
import { CopyButton, StatusBadge } from "@hcdn/ui/blocks/status";
import { Field } from "@hcdn/ui/blocks/field";
import { Badge } from "@hcdn/ui/components/badge";
import { Button } from "@hcdn/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hcdn/ui/components/dropdown-menu";
import { Input } from "@hcdn/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hcdn/ui/components/select";
import { Skeleton } from "@hcdn/ui/components/skeleton";
import { toast } from "@hcdn/ui/components/toaster";
import { cn } from "@hcdn/ui/lib/cn";
import { api } from "@/lib/api";
import { toastError } from "@/lib/hooks";
import { isDnsLabel } from "@/lib/net";
import { useClusters } from "@/components/cluster-select";

export function ClustersPage() {
  const { t } = useTranslation();
  const q = useClusters();
  const [nameDialog, setNameDialog] = React.useState<{ cluster: Cluster | null } | null>(null);
  const [dnsCluster, setDnsCluster] = React.useState<Cluster | null>(null);

  return (
    <div>
      <PageHeader
        title={t("集群")}
        description={t("集群是一组共享配置与 DNS 解析的边缘节点。用户的网站部署在其所属集群上。")}
        actions={
          <Button onClick={() => setNameDialog({ cluster: null })}>
            <Plus />
            {t("创建集群")}
          </Button>
        }
      />

      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retryLabel={t("重试")} title={t("集群列表加载失败")} />
      ) : q.data.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card">
          <EmptyState
            icon={<Boxes />}
            title={t("还没有集群")}
            description={t("先创建一个集群，再向其中添加节点并绑定 DNS 域名。")}
            action={
              <Button size="sm" onClick={() => setNameDialog({ cluster: null })}>
                <Plus />
                {t("创建集群")}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((c) => (
            <ClusterCard key={c.id} cluster={c} onRename={() => setNameDialog({ cluster: c })} onEditDns={() => setDnsCluster(c)} />
          ))}
        </div>
      )}

      <ClusterNameDialog state={nameDialog} onClose={() => setNameDialog(null)} />
      <ClusterDnsDialog cluster={dnsCluster} onClose={() => setDnsCluster(null)} />
    </div>
  );
}

function ClusterCard({ cluster: c, onRename, onEditDns }: { cluster: Cluster; onRename: () => void; onEditDns: () => void }) {
  const { t } = useTranslation();
  const bound = !!(c.dnsDomain && c.dnsName);
  const fqdn = bound ? `${c.dnsName}.${c.dnsDomain}` : "";
  const offline = c.nodesCount - c.onlineNodes;
  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-xs">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-subtle text-muted-foreground">
          <Boxes className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold tracking-tight">{c.name}</h3>
            {c.isDefault ? <Badge variant="soft">{t("默认")}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">ID {c.id}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mr-2 text-muted-foreground" aria-label={t("更多操作")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil />
              {t("重命名")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEditDns}>
              <Waypoints />
              {t("DNS 设置")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 pt-5">
        <div className="rounded-lg border bg-subtle px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Server className="size-3.5" />
            {t("节点在线")}
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-semibold tabular">{c.onlineNodes}</span>
            <span className="text-xs text-muted-foreground tabular">/ {c.nodesCount}</span>
            {offline > 0 ? (
              <StatusBadge tone="danger" className="ml-auto self-center">
                {t("{{n}} 离线", { n: offline })}
              </StatusBadge>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border bg-subtle px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="size-3.5" />
            {t("网站")}
          </div>
          <div className="mt-1 text-lg font-semibold tabular">{c.sitesCount}</div>
        </div>
      </div>

      <div className="flex-1 px-5 pt-4 pb-5">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("DNS 解析")}</div>
        {bound ? (
          <div className="space-y-1.5">
            <div className="flex h-9 items-center gap-1 rounded-md border bg-subtle pr-1 pl-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{fqdn}</span>
              <CopyButton value={fqdn} />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {t("域名")} <span className="text-foreground">{c.dnsDomain}</span> · {t("服务商")}{" "}
              <span className="text-foreground">{c.dnsProviderName || "—"}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-warning/40 bg-warning-soft/60 py-1.5 pr-1.5 pl-3 text-[13px] text-warning-foreground">
            <TriangleAlert className="size-4 shrink-0" />
            <span className="flex-1">{t("未绑定 DNS")}</span>
            <Button size="sm" variant="outline" className="h-7" onClick={onEditDns}>
              {t("绑定")}
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/nodes?clusterId=${c.id}`}>
            {t("查看节点")}
            <ArrowRight />
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={onEditDns}>
          <Waypoints />
          {t("DNS 设置")}
        </Button>
      </div>
    </div>
  );
}

function ClusterNameDialog({ state, onClose }: { state: { cluster: Cluster | null } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const editing = state?.cluster ?? null;
  React.useEffect(() => {
    if (state) {
      setName(state.cluster?.name ?? "");
      setError(null);
    }
  }, [state]);

  const save = useMutation({
    mutationFn: () => (editing ? api.updateCluster(editing.id, { name: name.trim() }) : api.createCluster(name.trim())),
    onSuccess: () => {
      toast.success(editing ? t("集群已重命名") : t("集群已创建"));
      void qc.invalidateQueries({ queryKey: ["clusters"] });
      onClose();
    },
    onError: (e) => (e instanceof ApiError && e.status === 409 ? setError(t(e.message)) : toastError(e, "保存失败")),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return setError(t("请输入集群名称"));
    if (v.length > 50) return setError(t("名称最多 50 个字符"));
    save.mutate();
  }

  return (
    <Dialog open={!!state} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? t("重命名集群") : t("创建集群")}</DialogTitle>
            <DialogDescription>{editing ? t("名称仅在管理后台中显示。") : t("创建后可在集群中添加节点，并绑定 DNS 域名。")}</DialogDescription>
          </DialogHeader>
          <Field label={t("集群名称")} htmlFor="cluster-name" error={error}>
            <Input id="cluster-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("如：亚太主集群")} autoFocus aria-invalid={!!error} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {editing ? t("保存") : t("创建")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TTL_OPTIONS = [60, 300, 600, 1800, 3600];

function ClusterDnsDialog({ cluster, onClose }: { cluster: Cluster | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const domains = useQuery({ queryKey: ["dns", "domains"], queryFn: api.dnsDomains, enabled: !!cluster });
  const [domainId, setDomainId] = React.useState("");
  const [dnsName, setDnsName] = React.useState("");
  const [ttl, setTtl] = React.useState("300");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!cluster) return;
    setDnsName(cluster.dnsName || "");
    setTtl("300");
    setError(null);
    setDomainId("");
  }, [cluster]);
  // Preselect the bound domain (matched by name) once the list arrives.
  React.useEffect(() => {
    if (!cluster || domainId || !domains.data) return;
    const match = domains.data.find((d) => d.name === cluster.dnsDomain) ?? (domains.data.length === 1 ? domains.data[0] : undefined);
    if (match) setDomainId(String(match.id));
  }, [cluster, domains.data, domainId]);

  const domain = domains.data?.find((d) => String(d.id) === domainId);
  const label = dnsName.trim().toLowerCase();
  const fqdn = domain && label ? `${label}.${domain.name}` : null;
  const bound = !!(cluster?.dnsDomain && cluster.dnsName);
  const changing = bound && fqdn !== null && fqdn !== `${cluster?.dnsName}.${cluster?.dnsDomain}`;

  const save = useMutation({
    mutationFn: () => api.updateClusterDns(cluster!.id, { domainId: Number(domainId), dnsName: label, ttl: Number(ttl) }),
    onSuccess: () => {
      toast.success(t("DNS 设置已保存"), { description: t("解析记录将在数分钟内同步到 DNS 服务商。") });
      void qc.invalidateQueries({ queryKey: ["clusters"] });
      void qc.invalidateQueries({ queryKey: ["nodes"] });
      onClose();
    },
    onError: (e) => (e instanceof ApiError && e.fields.dnsName ? setError(t(e.fields.dnsName)) : toastError(e, "保存失败")),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!domainId) return setError(t("请选择 DNS 域名"));
    if (!isDnsLabel(label)) return setError(t("子域名只能包含小写字母、数字和连字符，且不能以连字符开头或结尾"));
    setError(null);
    save.mutate();
  }

  const noDomains = !!domains.data && domains.data.length === 0;

  return (
    <Dialog open={!!cluster} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="grid min-w-0 gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{t("DNS 设置 · {{name}}", { name: cluster?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("集群内在线节点的 IP 会自动解析到下方生成的域名，用户网站通过 CNAME 接入。")}</DialogDescription>
          </DialogHeader>

          {noDomains ? (
            <div className="rounded-lg border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">
              {t("还没有可用的 DNS 域名。")}{" "}
              <Link to="/dns" className="font-medium text-primary hover:underline" onClick={onClose}>
                {t("前往添加")}
              </Link>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <Field label={t("子域名")} htmlFor="dns-name">
                  <Input
                    id="dns-name"
                    value={dnsName}
                    onChange={(e) => setDnsName(e.target.value)}
                    placeholder="cdn"
                    className="font-mono"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t("DNS 域名")} htmlFor="dns-domain">
                  <Select value={domainId} onValueChange={setDomainId}>
                    <SelectTrigger id="dns-domain" className="w-full">
                      <SelectValue placeholder={domains.isPending ? t("加载中…") : t("选择域名")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(domains.data ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          <span className="font-mono">{d.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="TTL" htmlFor="dns-ttl" description={t("较短的 TTL 能让节点故障切换更快生效，但会增加 DNS 查询量。")}>
                <Select value={ttl} onValueChange={setTtl}>
                  <SelectTrigger id="dns-ttl" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TTL_OPTIONS.map((v) => (
                      <SelectItem key={v} value={String(v)}>
                        {v < 60 ? `${v}s` : v < 3600 ? t("{{n}} 分钟", { n: v / 60 }) : t("{{n}} 小时", { n: v / 3600 })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="rounded-lg border bg-subtle p-4">
                <div className="text-xs font-medium text-muted-foreground">{t("生成的解析域名")}</div>
                <div className={cn("mt-1.5 font-mono text-[15px] font-medium break-all", !fqdn && "text-muted-foreground")}>
                  {fqdn ?? `<${t("子域名")}>.<${t("域名")}>`}
                </div>
                <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  <li>
                    • {t("每个在线节点的 IP 作为 A / AAAA 记录写入")} <code className="font-mono text-foreground">{fqdn ?? "…"}</code>
                  </li>
                  <li>
                    • {t("用户网站的 CNAME 目标形如")} <code className="font-mono break-all text-foreground">{fqdn ? `<id>.${fqdn}` : "…"}</code>
                  </li>
                </ul>
              </div>

              {changing ? (
                <div className="flex gap-2.5 rounded-lg border border-warning/35 bg-warning-soft px-3.5 py-3 text-[13px] text-warning-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{t("修改后，该集群下 {{n}} 个网站的 CNAME 目标会改变，用户需要更新各自的 DNS 解析。", { n: cluster?.sitesCount ?? 0 })}</span>
                </div>
              ) : null}
              {error ? <p className="-mt-2 text-[12.5px] font-medium text-destructive-foreground">{error}</p> : null}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={save.isPending} disabled={noDomains}>
              {t("保存")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
