import "@hcdn/ui/lib/fonts";
import "./styles.css";
import "./lib/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@hcdn/ui/components/theme-provider";
import { TooltipProvider } from "@hcdn/ui/components/tooltip";
import { Toaster } from "@hcdn/ui/components/toaster";
import { queryClient } from "./lib/api";
import { router } from "./routes";

async function enableMocks() {
  if (import.meta.env.MODE !== "mock") return;
  // `?mock=empty|error` switches the demo data scenario for this tab (see mocks/handlers.ts).
  const scenario = new URLSearchParams(window.location.search).get("mock");
  if (scenario != null) sessionStorage.setItem("hcdn-mock", scenario);
  const { setupWorker } = await import("msw/browser");
  const { handlers } = await import("./mocks/handlers");
  await setupWorker(...handlers).start({ onUnhandledRequest: "bypass", quiet: true });
}

void enableMocks().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
});
