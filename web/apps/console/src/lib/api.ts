import { createConsoleApi } from "@hcdn/api/console";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@hcdn/api/client";

export const UNAUTHORIZED_EVENT = "hcdn:unauthorized";

export const api = createConsoleApi({
  onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { retry: false },
  },
});
