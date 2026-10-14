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
      { path: "sites/new", element: <Placeholder title="添加网站" /> },
      { path: "sites/:id/*", element: <Placeholder title="网站详情" /> },
      { path: "certs", element: <Placeholder title="证书" /> },
      { path: "cache", element: <Placeholder title="缓存" /> },
      { path: "stats", element: <Placeholder title="统计分析" /> },
      { path: "logs", element: <Placeholder title="访问日志" /> },
      { path: "account", element: <Placeholder title="账号设置" /> },
      { path: "account/keys", element: <Placeholder title="API 密钥" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
