import * as React from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/alert-dialog";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { cn } from "../lib/cn";
import { AlertTriangle } from "lucide-react";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  /** When set, the user must type this exact text to enable the confirm button. */
  confirmPhrase?: string;
  confirmPhraseLabel?: React.ReactNode;
  onConfirm: () => void | Promise<unknown>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  destructive = false,
  confirmPhrase,
  confirmPhraseLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);
  const locked = confirmPhrase != null && typed.trim() !== confirmPhrase;

  async function handleConfirm() {
    if (locked) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller shows the error toast; keep the dialog open so the user can retry.
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            {destructive ? (
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive-soft text-destructive-foreground">
                <AlertTriangle className="size-4.5" />
              </span>
            ) : null}
            <div className="space-y-1.5">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {description ? <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription> : null}
            </div>
          </div>
        </AlertDialogHeader>
        {confirmPhrase != null ? (
          <div className={cn("space-y-2", destructive && "pl-12")}>
            <p className="text-[13px] text-muted-foreground">
              {confirmPhraseLabel ?? (
                <>
                  请输入 <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{confirmPhrase}</code> 以确认
                </>
              )}
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelText}</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={handleConfirm} disabled={locked} loading={busy}>
            {confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Hook form: const confirm = useConfirm(); await confirm({...}) inside handlers. */
export function useConfirm() {
  const [state, setState] = React.useState<(Omit<ConfirmDialogProps, "open" | "onOpenChange">) | null>(null);
  const confirm = React.useCallback((opts: Omit<ConfirmDialogProps, "open" | "onOpenChange">) => setState(opts), []);
  const dialog = state ? <ConfirmDialog open onOpenChange={(v) => !v && setState(null)} {...state} /> : null;
  return { confirm, dialog };
}
