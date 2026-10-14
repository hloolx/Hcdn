import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import { CircleCheck, CircleAlert, Info, TriangleAlert, Loader2 } from "lucide-react";
import { useTheme } from "./theme-provider";

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="top-center"
      gap={8}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        error: <CircleAlert className="size-4 text-destructive" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        info: <Info className="size-4 text-info" />,
        loading: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-lg !gap-2.5 !px-4 !py-3 font-sans",
          title: "!text-sm !font-medium",
          description: "!text-[13px] !text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !rounded-md",
          cancelButton: "!bg-muted !text-foreground !rounded-md",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
