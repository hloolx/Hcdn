import { Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { ThemeToggle } from "@hcdn/ui/blocks/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";

export function AuthLayout() {
  const { t, i18n } = useTranslation();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-subtle">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black_20%,transparent_75%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(50%_60%_at_50%_0%,var(--admin-accent-soft),transparent_70%)] opacity-80" />
      <header className="relative z-10 flex items-center justify-end gap-1 p-5">
        <LangToggle />
        <ThemeToggle lang={i18n.language === "en" ? "en" : "zh"} />
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">
          <Outlet />
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            {t("仅限授权人员访问，所有操作均会记录审计日志")}
          </p>
        </div>
      </main>
      <footer className="relative z-10 pb-6 text-center text-xs text-muted-foreground/70">© {new Date().getFullYear()} Hcdn</footer>
    </div>
  );
}
