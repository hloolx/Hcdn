// Package app wires configuration, storage, EdgeAPI and the HTTP handlers.
package app

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hloolx/Hcdn/services/console-api/internal/config"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/mailer"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

// App is the running service.
type App struct {
	cfg   *config.Config
	store *store.Store
	edge  *edgeapi.Client
	mail  *mailer.Mailer
	log   *slog.Logger
	now   func() time.Time

	ip       *httpx.IPResolver
	csrf     *httpx.CSRF
	globalRL *httpx.Limiter
	authRL   *httpx.Limiter

	sessions store.SessionStore

	adminAllow atomic.Pointer[[]netip.Prefix]
	settings   atomic.Pointer[runtimeSettings]

	siteSPA, consoleSPA, adminSPA *httpx.SPA

	userAPI  *http.ServeMux
	adminAPI *http.ServeMux

	// turnstileVerifyURL overrides Cloudflare's siteverify endpoint; empty
	// uses turnstileSiteverifyURL. Tests point this at an httptest server.
	turnstileVerifyURL string

	acmeSem chan struct{}
	base    context.Context // cancelled on shutdown; parent of background jobs

	dnsMu    sync.Mutex
	dnsCache map[int64]dnsCacheEntry

	regionMu      sync.Mutex
	regionByID    map[int64]region
	regionByCode  map[string]int64
	regionsLoaded time.Time

	bg sync.WaitGroup
}

// New builds the App (does not start listening).
func New(cfg *config.Config, st *store.Store, edge *edgeapi.Client, log *slog.Logger) (*App, error) {
	trusted, err := config.ParsePrefixes(cfg.TrustedProxies)
	if err != nil {
		return nil, err
	}
	a := &App{
		cfg:      cfg,
		store:    st,
		edge:     edge,
		mail:     mailer.New(cfg.SMTP),
		log:      log,
		now:      time.Now,
		ip:       &httpx.IPResolver{Trusted: trusted},
		csrf:     &httpx.CSRF{Secure: cfg.CookieSecure()},
		globalRL: httpx.NewLimiter(cfg.RateLimit.GlobalRPS, cfg.RateLimit.GlobalRPS*4),
		authRL:   httpx.NewLimiter(cfg.RateLimit.AuthPerMinute/60, cfg.RateLimit.AuthPerMinute),
		dnsCache: map[int64]dnsCacheEntry{},
		acmeSem:  make(chan struct{}, 4),
		base:     context.Background(),
	}
	if st != nil {
		a.sessions = st
	}
	if a.siteSPA, err = httpx.NewSPA(cfg.Static.Site); err != nil {
		return nil, err
	}
	if a.consoleSPA, err = httpx.NewSPA(cfg.Static.Console); err != nil {
		return nil, err
	}
	if a.adminSPA, err = httpx.NewSPA(cfg.Static.Admin); err != nil {
		return nil, err
	}
	allow, _ := config.ParsePrefixes(cfg.AdminIPAllowlist)
	a.adminAllow.Store(&allow)
	a.settings.Store(defaultRuntimeSettings(cfg))
	a.userAPI = http.NewServeMux()
	a.adminAPI = http.NewServeMux()
	a.routesUser(a.userAPI)
	a.routesAdmin(a.adminAPI)
	return a, nil
}

// Run serves until ctx is cancelled.
func (a *App) Run(ctx context.Context) error {
	a.base = ctx
	if a.store != nil {
		if err := a.loadSettings(ctx); err != nil {
			a.log.Warn("load settings", "err", err)
		}
		if err := a.store.FailStaleAcmeJobs(ctx); err != nil {
			a.log.Warn("reset acme jobs", "err", err)
		}
		a.bg.Add(1)
		go a.housekeeping(ctx)
	}
	srv := &http.Server{
		Addr:              a.cfg.Listen,
		Handler:           a,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          slog.NewLogLogger(a.log.Handler(), slog.LevelWarn),
	}
	ln, err := net.Listen("tcp", a.cfg.Listen)
	if err != nil {
		return err
	}
	errCh := make(chan error, 1)
	go func() {
		if a.cfg.TLS.CertFile != "" {
			srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
			a.log.Info("listening (TLS)", "addr", a.cfg.Listen)
			errCh <- srv.ServeTLS(ln, a.cfg.TLS.CertFile, a.cfg.TLS.KeyFile)
		} else {
			a.log.Info("listening", "addr", a.cfg.Listen)
			errCh <- srv.Serve(ln)
		}
	}()
	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	shCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err = srv.Shutdown(shCtx)
	a.bg.Wait()
	return err
}

func (a *App) housekeeping(ctx context.Context) {
	defer a.bg.Done()
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		a.store.Purge(ctx, a.now(), a.cfg.LoginWindow())
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ---------------------------------------------------------------- top-level routing

type hostKind int

const (
	hostUnknown hostKind = iota
	hostSite
	hostConsole
	hostAdmin
	hostAPI
)

func (a *App) classify(host string) hostKind {
	h := httpx.HostOnly(host)
	switch {
	case slices.Contains(a.cfg.Hosts.Admin, h):
		return hostAdmin
	case slices.Contains(a.cfg.Hosts.Console, h):
		return hostConsole
	case slices.Contains(a.cfg.Hosts.API, h):
		return hostAPI
	case slices.Contains(a.cfg.Hosts.Site, h):
		return hostSite
	}
	return hostUnknown
}

// script-src/frame-src/connect-src additionally allow challenges.cloudflare.com
// so the Turnstile widget (login/register/forgot-password) can load, run and
// report back; everything else stays as strict as before.
const csp = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
	"script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; " +
	"connect-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

// ServeHTTP is the root handler.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := a.now()
	rw := &statusWriter{ResponseWriter: w, status: 200}
	h := w.Header()
	h.Set("Content-Security-Policy", csp)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	if a.ip.IsTLS(r) {
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	}
	clientIP := a.ip.ClientIP(r)
	r = r.WithContext(withClientIP(r.Context(), clientIP))

	defer func() {
		if v := recover(); v != nil {
			if v == http.ErrAbortHandler {
				panic(v)
			}
			a.log.Error("panic", "err", v, "path", r.URL.Path)
			httpx.WriteError(rw, nil)
		}
		a.log.Debug("http", "method", r.Method, "host", r.Host, "path", r.URL.Path, "status", rw.status,
			"ip", clientIP.String(), "ms", a.now().Sub(start).Milliseconds())
	}()

	if r.URL.Path == "/healthz" {
		a.healthz(rw, r)
		return
	}
	if ok, wait := a.globalRL.Allow("g:" + clientIP.String()); !ok {
		httpx.WriteError(rw, rateLimited(wait))
		return
	}

	kind := a.classify(r.Host)
	path := r.URL.Path
	switch kind {
	case hostAdmin:
		if !a.adminAllowed(clientIP) {
			httpx.WriteError(rw, httpx.Forbidden())
			return
		}
		a.csrf.Ensure(rw, r)
		if hasPrefixPath(path, "/api/admin/v1") {
			a.serveAPI(rw, r, a.adminAPI)
			return
		}
		if hasPrefixPath(path, "/api") {
			httpx.WriteError(rw, httpx.NotFound())
			return
		}
		a.adminSPA.ServeHTTP(rw, r)
	case hostConsole, hostAPI:
		if kind == hostConsole {
			a.csrf.Ensure(rw, r)
		}
		if hasPrefixPath(path, "/api/v1") {
			a.serveAPI(rw, r, a.userAPI)
			return
		}
		if kind == hostAPI || hasPrefixPath(path, "/api") {
			httpx.WriteError(rw, httpx.NotFound())
			return
		}
		a.consoleSPA.ServeHTTP(rw, r)
	case hostSite:
		if hasPrefixPath(path, "/api") {
			httpx.WriteError(rw, httpx.NotFound())
			return
		}
		a.siteSPA.ServeHTTP(rw, r)
	default:
		http.Error(rw, "unknown host", http.StatusMisdirectedRequest)
	}
}

func hasPrefixPath(p, prefix string) bool {
	return p == prefix || len(p) > len(prefix) && p[:len(prefix)] == prefix && p[len(prefix)] == '/'
}

func (a *App) serveAPI(w http.ResponseWriter, r *http.Request, mux *http.ServeMux) {
	if err := a.csrf.Check(r); err != nil {
		httpx.WriteError(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, httpx.MaxBody)
	mux.ServeHTTP(w, r)
}

func (a *App) adminAllowed(ip netip.Addr) bool {
	list := *a.adminAllow.Load()
	if len(list) == 0 {
		return true
	}
	for _, p := range list {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

func (a *App) healthz(w http.ResponseWriter, r *http.Request) {
	status := map[string]string{"status": "ok"}
	code := http.StatusOK
	if a.store != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := a.store.DB.PingContext(ctx); err != nil {
			status["status"], status["db"] = "degraded", "unreachable"
			code = http.StatusServiceUnavailable
		}
	}
	httpx.WriteJSON(w, code, status)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// ---------------------------------------------------------------- context helpers

type ctxKey int

const clientIPKey ctxKey = 1

func withClientIP(ctx context.Context, ip netip.Addr) context.Context {
	return context.WithValue(ctx, clientIPKey, ip)
}

func clientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(clientIPKey).(netip.Addr); ok {
		return ip.String()
	}
	return ""
}

func clientIPAddr(r *http.Request) netip.Addr {
	ip, _ := r.Context().Value(clientIPKey).(netip.Addr)
	return ip
}

func rateLimited(wait int) *httpx.Error {
	e := httpx.Errorf(http.StatusTooManyRequests, "rate_limited", "请求过于频繁，请 %d 秒后重试", wait)
	e.RetryAfter = wait
	return e
}
