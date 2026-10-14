import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@hcdn/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hcdn/ui/components/dropdown-menu";
import { setLang } from "@/lib/i18n";

export function LangToggle() {
  const { i18n } = useTranslation();
  const current = i18n.language === "en" ? "en" : "zh";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Language">
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuItem onSelect={() => setLang("zh")} className={current === "zh" ? "text-primary" : ""}>
          简体中文
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setLang("en")} className={current === "en" ? "text-primary" : ""}>
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
