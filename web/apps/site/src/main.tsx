import "@hcdn/ui/lib/fonts";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@hcdn/ui/components/theme-provider";
import { TooltipProvider } from "@hcdn/ui/components/tooltip";
import { SiteLayout } from "./components/site-chrome";
import { HomePage } from "./pages/home";
import { PricingPage } from "./pages/pricing";
import { NetworkPage } from "./pages/network";
import { DocsPage } from "./pages/docs";
import { LegalPage, SiteNotFound } from "./pages/legal";

const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/pricing", element: <PricingPage /> },
      { path: "/network", element: <NetworkPage /> },
      { path: "/docs", element: <DocsPage /> },
      { path: "/terms", element: <LegalPage kind="terms" /> },
      { path: "/privacy", element: <LegalPage kind="privacy" /> },
      { path: "/aup", element: <LegalPage kind="aup" /> },
      { path: "*", element: <SiteNotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
