import { Laptop, Moon, Sun } from "lucide-react";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { useTheme, type Theme } from "../components/theme-provider";
import { cn } from "../lib/cn";

const OPTIONS: { value: Theme; icon: typeof Sun; zh: string; en: string }[] = [
  { value: "light", icon: Sun, zh: "浅色", en: "Light" },
  { value: "dark", icon: Moon, zh: "深色", en: "Dark" },
  { value: "system", icon: Laptop, zh: "跟随系统", en: "System" },
];

export function ThemeToggle({ lang = "zh", className }: { lang?: "zh" | "en"; className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("text-muted-foreground", className)} aria-label="Theme">
          {resolvedTheme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)} className={cn(theme === o.value && "text-primary [&_svg]:!text-primary")}>
            <o.icon />
            {lang === "zh" ? o.zh : o.en}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Two-state segmented switch used on the marketing site footer. */
export function ThemeSegmented({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.en}
          onClick={() => setTheme(o.value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground",
            theme === o.value && "bg-accent text-foreground",
          )}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
