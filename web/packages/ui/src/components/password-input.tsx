import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../lib/cn";
import { Input } from "./input";

function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** 0–4 strength score with a label, for sign-up and password change forms. */
function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["很弱", "弱", "一般", "强", "很强"];
  return { score, label: labels[score] ?? "" };
}

function PasswordStrength({ value }: { value: string }) {
  const { score, label } = passwordStrength(value);
  if (!value) return null;
  const colors = ["bg-destructive", "bg-destructive", "bg-warning", "bg-success", "bg-success"];
  return (
    <div className="flex items-center gap-2">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("h-1 rounded-full bg-muted transition-colors", i < Math.max(1, score) && colors[score])} />
        ))}
      </div>
      <span className="w-8 text-right text-[11.5px] text-muted-foreground">{label}</span>
    </div>
  );
}

export { PasswordInput, PasswordStrength, passwordStrength };
