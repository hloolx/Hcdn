import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "@hcdn/api/client";
import { LogoMark } from "@hcdn/ui/blocks/logo";
import { api, UNAUTHORIZED_EVENT } from "./api";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: 5 * 60_000 });
}

export function usePublicConfig() {
  return useQuery({ queryKey: ["public-config"], queryFn: api.config, staleTime: 10 * 60_000 });
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="size-10 animate-pulse" />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-loader rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

/** Gate for authenticated routes: redirects to /login?next=… on 401. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  React.useEffect(() => {
    const onUnauthorized = () => {
      qc.clear();
      const next = encodeURIComponent(location.pathname + location.search);
      navigate(`/login?next=${next}`, { replace: true });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [location.pathname, location.search, navigate, qc]);

  if (me.isPending) return <FullPageLoader />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      return <Navigate to={`/login?next=${next}`} replace />;
    }
    throw me.error;
  }
  return <>{children}</>;
}

/** Only allow relative in-app redirect targets. */
export function safeNext(next: string | null): string {
  if (!next) return "/";
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) return decoded;
  } catch {
    /* ignore */
  }
  return "/";
}
