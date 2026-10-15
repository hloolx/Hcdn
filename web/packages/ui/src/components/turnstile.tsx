import * as React from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";
import { useTheme } from "./theme-provider";

/**
 * Cloudflare Turnstile (https://developers.cloudflare.com/turnstile/) human
 * verification widget, rendered "explicit" so we control theme/language and
 * can reset it for a fresh (single-use) token after a failed submit.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __hcdnTurnstileLoad?: Promise<TurnstileApi>;
  }
}

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!window.__hcdnTurnstileLoad) {
    window.__hcdnTurnstileLoad = new Promise<TurnstileApi>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      const script = existing ?? document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.addEventListener("load", () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("turnstile: script loaded without window.turnstile"));
      });
      script.addEventListener("error", () => reject(new Error("turnstile: failed to load script")));
      if (!existing) document.head.appendChild(script);
    });
  }
  return window.__hcdnTurnstileLoad;
}

export interface TurnstileHandle {
  /** Request a fresh token; call this after any failed submit (tokens are single-use). */
  reset: () => void;
}

export interface TurnstileProps {
  /** Cloudflare site key. Nothing is rendered when empty. */
  siteKey: string;
  /** UI language, following the app's i18n language. */
  lang?: "zh" | "en";
  className?: string;
  /** Called with a fresh token whenever the challenge is solved. */
  onVerify: (token: string) => void;
  /** Called when a previously-issued token expires; clear it from form state. */
  onExpire?: () => void;
  onError?: () => void;
}

const WIDGET_HEIGHT = "h-[65px]";

const Turnstile = React.forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { siteKey, lang = "zh", className, onVerify, onExpire, onError },
  ref,
) {
  const { resolvedTheme } = useTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const apiRef = React.useRef<TurnstileApi | null>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");

  // Refs so the mount effect below does not need these in its dependency list.
  const onVerifyRef = React.useRef(onVerify);
  onVerifyRef.current = onVerify;
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  React.useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;
    setStatus("loading");
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        apiRef.current = api;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          theme: resolvedTheme,
          language: lang === "en" ? "en-US" : "zh-CN",
          size: "flexible",
          callback: (token) => onVerifyRef.current(token),
          "expired-callback": () => onExpireRef.current?.(),
          "error-callback": () => onErrorRef.current?.(),
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      if (apiRef.current && widgetIdRef.current) {
        apiRef.current.remove(widgetIdRef.current);
      }
      apiRef.current = null;
      widgetIdRef.current = null;
    };
    // Theme/language changes remount the widget (new effect run) rather than mutating it in place.
  }, [siteKey, resolvedTheme, lang]);

  React.useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (apiRef.current && widgetIdRef.current) apiRef.current.reset(widgetIdRef.current);
      },
    }),
    [],
  );

  if (!siteKey) return null;

  return (
    <div className={cn("w-full", className)}>
      <div ref={containerRef} className={cn("w-full", status !== "ready" && "sr-only")} />
      {status === "loading" ? <Skeleton className={cn("w-full rounded-lg", WIDGET_HEIGHT)} /> : null}
      {status === "error" ? (
        <div
          className={cn(
            "flex w-full items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-[12.5px] text-muted-foreground",
            WIDGET_HEIGHT,
          )}
        >
          {lang === "en" ? "Couldn't load verification. Please refresh the page." : "人机验证组件加载失败，请刷新页面重试"}
        </div>
      ) : null}
    </div>
  );
});

export { Turnstile };
