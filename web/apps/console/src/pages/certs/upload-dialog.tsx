import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, FileUp, Info } from "lucide-react";
import { ApiError, errorMessage } from "@hcdn/api/client";
import { Field } from "@hcdn/ui/blocks/field";
import { Button } from "@hcdn/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hcdn/ui/components/dialog";
import { Input } from "@hcdn/ui/components/input";
import { Textarea } from "@hcdn/ui/components/textarea";
import { toast } from "@hcdn/ui/components/toaster";
import { api } from "@/lib/api";

const CERT_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const KEY_RE = /-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (RSA |EC )?PRIVATE KEY-----/;

export function certPemError(pem: string): string | null {
  if (!pem.trim()) return "请粘贴证书内容";
  const n = pem.match(CERT_RE)?.length ?? 0;
  if (n === 0) return "未找到证书，内容应以 -----BEGIN CERTIFICATE----- 开头";
  if (/PRIVATE KEY/.test(pem)) return "这里只填写证书，私钥请填写在下方";
  return null;
}

export function keyPemError(pem: string): string | null {
  if (!pem.trim()) return "请粘贴私钥内容";
  if (/ENCRYPTED PRIVATE KEY/.test(pem)) return "不支持加密的私钥，请先解密（openssl pkey -in key.pem -out plain.pem）";
  if (!KEY_RE.test(pem)) return "未找到私钥，内容应以 -----BEGIN PRIVATE KEY----- 开头";
  return null;
}

function PemField({ id, label, value, onChange, error, hint, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: React.ReactNode; placeholder: string }) {
  const { t } = useTranslation();
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      description={hint}
      aside={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".pem,.crt,.cer,.key,.txt"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 64 * 1024) return toast.error(t("文件过大，PEM 文件通常小于 64 KB"));
              onChange(await f.text());
              e.target.value = "";
            }}
          />
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => fileRef.current?.click()}>
            <FileUp />
            {t("从文件读取")}
          </Button>
        </>
      }
    >
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={5}
        spellCheck={false}
        aria-invalid={!!error}
        className="max-h-48 font-mono text-[11.5px] leading-5 break-all placeholder:text-muted-foreground/60"
      />
    </Field>
  );
}

export function UploadCertDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [cert, setCert] = React.useState("");
  const [key, setKey] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) {
      setName("");
      setCert("");
      setKey("");
      setTouched(false);
      setServerErrors({});
    }
  }, [open]);

  const certErr = certPemError(cert);
  const keyErr = keyPemError(key);
  const chain = cert.match(CERT_RE)?.length ?? 0;

  const mutation = useMutation({
    mutationFn: () => api.uploadCert({ name: name.trim() || undefined, certPem: cert.trim(), keyPem: key.trim() }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["certs"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      toast.success(t("证书 {{name}} 已上传", { name: c.name }));
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) setServerErrors(e.fields);
      toast.error(errorMessage(e));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("上传证书")}</DialogTitle>
          <DialogDescription>{t("PEM 格式的证书（含中间证书链）和对应私钥。私钥加密存储，不会再次显示。")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (certErr || keyErr) return;
            mutation.mutate();
          }}
        >
          <Field label={t("名称")} htmlFor="cert-name" description={t("可选，便于识别；默认使用证书中的主域名。")}>
            <Input id="cert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="www.example.com" maxLength={64} />
          </Field>
          <PemField
            id="cert-pem"
            label={t("证书（PEM）")}
            value={cert}
            onChange={(v) => {
              setCert(v);
              setServerErrors((s) => ({ ...s, certPem: "" }));
            }}
            error={(touched && certErr ? t(certErr) : undefined) || serverErrors.certPem || undefined}
            hint={
              chain > 0 && !certErr ? (
                <span className="inline-flex items-center gap-1 text-success-foreground">
                  <CheckCircle2 className="size-3.5" />
                  {chain > 1 ? t("检测到 {{n}} 张证书（含中间证书）", { n: chain }) : t("检测到 1 张证书。如有中间证书，请一并粘贴在后面。")}
                </span>
              ) : (
                t("服务器证书在前，中间证书在后。")
              )
            }
            placeholder={"-----BEGIN CERTIFICATE-----\nMIIF…\n-----END CERTIFICATE-----"}
          />
          <PemField
            id="key-pem"
            label={t("私钥（PEM）")}
            value={key}
            onChange={(v) => {
              setKey(v);
              setServerErrors((s) => ({ ...s, keyPem: "" }));
            }}
            error={(touched && keyErr ? t(keyErr) : undefined) || serverErrors.keyPem || undefined}
            placeholder={"-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----"}
          />
          <p className="flex gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("上传的证书不会自动续期，请在到期前重新上传。需要免费且自动续期的证书，请使用「申请免费证书」。")}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              {t("取消")}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {t("上传")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
