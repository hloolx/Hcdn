import { createBrowserRouter } from "react-router";
import { AdminLayout } from "@/layouts/admin-layout";
import { AuthLayout } from "@/layouts/auth-layout";
import { RouteError } from "@/components/route-error";
import { LoginPage } from "@/pages/login";
import { NotFoundPage } from "@/pages/not-found";
import { FullPageLoader } from "@/lib/auth";

// Pages are split per route so charts and maps only load where they are used.
export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    path: "/",
    element: <AdminLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { index: true, lazy: () => import("@/pages/dashboard").then((m) => ({ Component: m.DashboardPage })) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
