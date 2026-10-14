import "@hcdn/ui/lib/fonts";
import "./styles.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@hcdn/ui/components/theme-provider";
import { TooltipProvider } from "@hcdn/ui/components/tooltip";
import { SiteLayout } from "./components/site-chrome";
import { HomePage } from "./pages/home";
import { SiteNotFound } from "./pages/legal";

const PricingPage = lazy(() => import("./pages/pricing").then((m) => ({ default: m.PricingPage })));
const NetworkPage = lazy(() => import("./pages/network").then((m) => ({ default: m.NetworkPage })));
const DocsPage = lazy(() => import("./pages/docs").then((m) => ({ default: m.DocsPage })));
const LegalPage = lazy(() => import("./pages/legal").then((m) => ({ default: m.LegalPage })));

const page = (el: React.ReactNode) => <Suspense fallback={<div className="min-h-[60vh]" />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: <SiteLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/pricing", element: page(<PricingPage />) },
      { path: "/network", element: page(<NetworkPage />) },
      { path: "/docs", element: page(<DocsPage />) },
      { path: "/terms", element: page(<LegalPage kind="terms" />) },
      { path: "/privacy", element: page(<LegalPage kind="privacy" />) },
      { path: "/aup", element: page(<LegalPage kind="aup" />) },
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
