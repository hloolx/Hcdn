import * as React from "react";
import { cn } from "../lib/cn";
import { inputBase } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea data-slot="textarea" className={cn(inputBase, "min-h-20 py-2 leading-relaxed", className)} {...props} />
  );
}

export { Textarea };
