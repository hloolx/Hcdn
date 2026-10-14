import { createBrowserRouter } from "react-router";
import { ConsoleLayout } from "@/layouts/console-layout";
import { AuthLayout } from "@/layouts/auth-layout";
import { LoginPage } from "@/pages/auth/login";
import { RegisterPage } from "@/pages/auth/register";
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "@/pages/auth/password";
import { NotFoundPage, OverviewPage } from "@/pages/overview";
import { RouteError } from "@/components/route-error";
import { Placeholder } from "@/components/placeholder";
import { SitesPage } from "@/pages/sites/list";
import { NewSitePage } from "@/pages/sites/new";
import { SiteLayout } from "@/pages/sites/detail/layout";
import { SiteOverviewTab } from "@/pages/sites/detail/overview";
import { SiteDomainsTab } from "@/pages/sites/detail/domains";
import { SiteHttpsTab } from "@/pages/sites/detail/https";
import { SiteCacheTab } from "@/pages/sites/detail/cache";
import { SiteSecurityTab } from "@/pages/sites/detail/security";
import { SiteLogsTab } from "@/pages/sites/detail/logs";
import { CertsPage } from "@/pages/certs";
import { CachePage } from "@/pages/cache";
import { StatsPage } from "@/pages/stats";
import { LogsPage } from "@/pages/logs";

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
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "sites", element: <SitesPage /> },
      { path: "sites/new", element: <NewSitePage /> },
      {
        path: "sites/:id",
        element: <SiteLayout />,
        children: [
          { index: true, element: <SiteOverviewTab /> },
          { path: "domains", element: <SiteDomainsTab /> },
          { path: "https", element: <SiteHttpsTab /> },
          { path: "cache", element: <SiteCacheTab /> },
          { path: "security", element: <SiteSecurityTab /> },
          { path: "logs", element: <SiteLogsTab /> },
        ],
      },
      { path: "certs", element: <CertsPage /> },
      { path: "cache", element: <CachePage /> },
      { path: "stats", element: <StatsPage /> },
      { path: "logs", element: <LogsPage /> },
      { path: "account", element: <Placeholder title="账号设置" /> },
      { path: "account/keys", element: <Placeholder title="API 密钥" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
