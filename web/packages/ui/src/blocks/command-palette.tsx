import * as React from "react";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "../lib/cn";
import { Kbd } from "../components/misc";

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
  keywords?: string[];
  onSelect: () => void;
}

/** ⌘K palette. Pass static pages plus dynamic items (e.g. the user's sites). */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  placeholder = "搜索…",
  emptyText = "没有匹配的结果",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
  emptyText?: string;
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
        <DialogPrimitive.Content className="fixed top-[14vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command className="flex flex-col" loop>
            <div className="flex items-center gap-2.5 border-b px-4">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                placeholder={placeholder}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2 scrollbar-thin">
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">{emptyText}</Command.Empty>
              {groups.map(([group, list]) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {list.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.label} ${item.keywords?.join(" ") ?? ""} ${item.id}`}
                      onSelect={() => {
                        onOpenChange(false);
                        item.onSelect();
                      }}
                      className={cn(
                        "flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 text-sm select-none data-[selected=true]:bg-accent",
                      )}
                    >
                      {item.icon ? <item.icon className="size-4 text-muted-foreground" /> : null}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint ? <span className="text-xs text-muted-foreground">{item.hint}</span> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Topbar trigger that looks like a search field. */
export function CommandTrigger({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 w-full max-w-sm items-center gap-2.5 rounded-lg border bg-subtle px-3 text-[13px] text-muted-foreground shadow-xs transition-colors hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <Search className="size-4" />
      <span className="flex-1 truncate text-left">{label}</span>
      <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
    </button>
  );
}

/** Registers the ⌘K / Ctrl+K shortcut. */
export function useCommandShortcut(onToggle: () => void) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onToggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
}
