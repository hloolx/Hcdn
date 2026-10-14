import { createBrowserRouter } from "react-router";
import { ConsoleLayout } from "@/layouts/console-layout";
import { AuthLayout } from "@/layouts/auth-layout";
import { LoginPage } from "@/pages/auth/login";
import { RegisterPage } from "@/pages/auth/register";
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "@/pages/auth/password";
import { RouteError } from "@/components/route-error";
import { FullPageLoader } from "@/lib/auth";

// Console pages are code-split per route; charts (recharts, the world map)
// only load on pages that use them.
const lazy = <M,>(load: () => Promise<M>, pick: (m: M) => React.ComponentType) => async () => ({ Component: pick(await load()) });

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
    ],
  },
  {
    path: "/",
    element: <ConsoleLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { index: true, lazy: lazy(() => import("@/pages/overview"), (m) => m.OverviewPage) },
      { path: "sites", lazy: lazy(() => import("@/pages/sites/list"), (m) => m.SitesPage) },
      { path: "sites/new", lazy: lazy(() => import("@/pages/sites/new"), (m) => m.NewSitePage) },
      {
        path: "sites/:id",
        lazy: lazy(() => import("@/pages/sites/detail/layout"), (m) => m.SiteLayout),
        children: [
          { index: true, lazy: lazy(() => import("@/pages/sites/detail/overview"), (m) => m.SiteOverviewTab) },
          { path: "domains", lazy: lazy(() => import("@/pages/sites/detail/domains"), (m) => m.SiteDomainsTab) },
          { path: "https", lazy: lazy(() => import("@/pages/sites/detail/https"), (m) => m.SiteHttpsTab) },
          { path: "cache", lazy: lazy(() => import("@/pages/sites/detail/cache"), (m) => m.SiteCacheTab) },
          { path: "security", lazy: lazy(() => import("@/pages/sites/detail/security"), (m) => m.SiteSecurityTab) },
          { path: "logs", lazy: lazy(() => import("@/pages/sites/detail/logs"), (m) => m.SiteLogsTab) },
        ],
      },
      { path: "certs", lazy: lazy(() => import("@/pages/certs"), (m) => m.CertsPage) },
      { path: "cache", lazy: lazy(() => import("@/pages/cache"), (m) => m.CachePage) },
      { path: "stats", lazy: lazy(() => import("@/pages/stats"), (m) => m.StatsPage) },
      { path: "logs", lazy: lazy(() => import("@/pages/logs"), (m) => m.LogsPage) },
      { path: "account", lazy: lazy(() => import("@/pages/account/profile"), (m) => m.AccountPage) },
      { path: "account/keys", lazy: lazy(() => import("@/pages/account/keys"), (m) => m.AccessKeysPage) },
      { path: "*", lazy: lazy(() => import("@/pages/overview"), (m) => m.NotFoundPage) },
    ],
  },
]);
