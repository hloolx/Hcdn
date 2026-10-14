import * as React from "react";
import { Search, X } from "lucide-react";
import { InputGroup } from "@hcdn/ui/components/input";
import { cn } from "@hcdn/ui/lib/cn";
import { useDebounced } from "@/lib/hooks";

/** Debounced search box; `onChange` fires after typing settles. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = React.useState(value);
  const debounced = useDebounced(text, 300);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  React.useEffect(() => setText(value), [value]);
  React.useEffect(() => {
    if (debounced !== value) onChangeRef.current(debounced.trim());
  }, [debounced]);
  return (
    <InputGroup
      className={cn("w-full sm:w-64", className)}
      leading={<Search />}
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={placeholder}
      inputClassName="h-8"
      trailing={
        text ? (
          <button type="button" className="rounded p-0.5 hover:bg-accent hover:text-foreground" onClick={() => setText("")} aria-label="Clear">
            <X className="size-3.5" />
          </button>
        ) : null
      }
    />
  );
}
