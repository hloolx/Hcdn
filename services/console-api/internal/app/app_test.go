package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hloolx/Hcdn/services/console-api/internal/config"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

type fakeSessions struct {
	m map[string]*store.Session // keyed by raw id
}

func (f *fakeSessions) CreateSession(_ context.Context, kind string, id int64, name, ip, ua string, now time.Time) (string, error) {
	raw := store.NewSessionID()
	f.m[raw] = &store.Session{Kind: kind, SubjectID: id, Username: name, CreatedAt: now.Unix(), LastSeenAt: now.Unix(), ExpiresAt: now.Add(store.SessionAbsolute).Unix()}
	return raw, nil
}

func (f *fakeSessions) GetSession(_ context.Context, kind, raw string, now time.Time) (*store.Session, error) {
	s, ok := f.m[raw]
	if !ok || s.Kind != kind || now.Unix() >= s.ExpiresAt || now.Unix()-s.LastSeenAt >= int64(store.SessionIdle/time.Second) {
		return nil, store.ErrNotFound
	}
	return s, nil
}

func (f *fakeSessions) DeleteSession(_ context.Context, raw string) error {
	delete(f.m, raw)
	return nil
}

func (f *fakeSessions) DeleteSessionsFor(context.Context, string, int64, string) error { return nil }

func testApp(t *testing.T) (*App, *fakeSessions) {
	t.Helper()
	sec := false
	cfg := &config.Config{Listen: "127.0.0.1:0"}
	cfg.DB.DSN = "x"
	cfg.EdgeAPI.Endpoints = []string{"http://127.0.0.1:1"}
	cfg.Cookie.Secure = &sec
	cfg.Hosts.Console = []string{"console.example.com"}
	cfg.Hosts.Admin = []string{"admin.example.com"}
	cfg.Hosts.Site = []string{"www.example.com"}
	cfg.AdminIPAllowlist = []string{"192.0.2.0/24"}
	cfg.RateLimit.GlobalRPS, cfg.RateLimit.AuthPerMinute = 1000, 1000
	a, err := New(cfg, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	fs := &fakeSessions{m: map[string]*store.Session{}}
	a.sessions = fs
	return a, fs
}

func TestSessionMiddleware(t *testing.T) {
	a, fs := testApp(t)
	var seen int64
	h := a.user(func(w http.ResponseWriter, r *http.Request, p *principal) error {
		seen = p.id()
		return writeJSON(w, map[string]bool{"ok": true})
	})
	do := func(cookie *http.Cookie) int {
		req := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := do(nil); c != 401 {
		t.Fatalf("no cookie: %d", c)
	}
	if c := do(&http.Cookie{Name: userCookie, Value: "bogus"}); c != 401 {
		t.Fatalf("bogus cookie: %d", c)
	}
	raw, _ := fs.CreateSession(context.Background(), store.KindUser, 7, "alice", "", "", time.Now())
	if c := do(&http.Cookie{Name: userCookie, Value: raw}); c != 200 || seen != 7 {
		t.Fatalf("valid session: %d seen=%d", c, seen)
	}
	// An admin session must not authenticate customer endpoints and vice versa.
	adminRaw, _ := fs.CreateSession(context.Background(), store.KindAdmin, 1, "root", "", "", time.Now())
	if c := do(&http.Cookie{Name: userCookie, Value: adminRaw}); c != 401 {
		t.Fatalf("admin session accepted for user API: %d", c)
	}
	// Idle timeout.
	fs.m[raw].LastSeenAt = time.Now().Add(-13 * time.Hour).Unix()
	if c := do(&http.Cookie{Name: userCookie, Value: raw}); c != 401 {
		t.Fatalf("idle session accepted: %d", c)
	}
}

func TestRoutingAndCSRF(t *testing.T) {
	a, _ := testApp(t)
	serve := func(method, host, path, remote string, hdr map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://"+host+path, strings.NewReader("{}"))
		req.RemoteAddr = remote
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		for _, c := range cookies {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		return rec
	}
	// Security headers + CSRF cookie on console host.
	rec := serve("GET", "console.example.com", "/api/v1/nope", "203.0.113.5:1", nil)
	if rec.Header().Get("Content-Security-Policy") == "" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("security headers missing")
	}
	var csrf *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "hcdn_csrf" {
			csrf = c
		}
	}
	if csrf == nil {
		t.Fatal("csrf cookie not set")
	}
	// Unsafe request without token is rejected with code csrf.
	rec = serve("POST", "console.example.com", "/api/v1/auth/logout", "203.0.113.5:1",
		map[string]string{"Origin": "http://console.example.com"}, csrf)
	if rec.Code != 403 || !strings.Contains(rec.Body.String(), `"csrf"`) {
		t.Fatalf("missing token: %d %s", rec.Code, rec.Body.String())
	}
	// With token + origin it reaches the handler (logout without session = 204).
	rec = serve("POST", "console.example.com", "/api/v1/auth/logout", "203.0.113.5:1",
		map[string]string{"Origin": "http://console.example.com", "X-CSRF-Token": csrf.Value}, csrf)
	if rec.Code == 403 {
		t.Fatalf("valid csrf rejected: %s", rec.Body.String())
	}
	// Admin API is not served on the console host.
	rec = serve("GET", "console.example.com", "/api/admin/v1/auth/me", "192.0.2.1:1", nil)
	if rec.Code != 404 {
		t.Fatalf("admin api on console host: %d", rec.Code)
	}
	// Admin host enforces the allowlist.
	rec = serve("GET", "admin.example.com", "/api/admin/v1/auth/me", "203.0.113.5:1", nil)
	if rec.Code != 403 {
		t.Fatalf("admin allowlist not enforced: %d", rec.Code)
	}
	rec = serve("GET", "admin.example.com", "/api/admin/v1/auth/me", "192.0.2.1:1", nil)
	if rec.Code != 401 {
		t.Fatalf("admin api from allowed ip: %d", rec.Code)
	}
	// Unknown host.
	rec = serve("GET", "other.example.net", "/", "203.0.113.5:1", nil)
	if rec.Code != http.StatusMisdirectedRequest {
		t.Fatalf("unknown host: %d", rec.Code)
	}
	// healthz on any host.
	rec = serve("GET", "other.example.net", "/healthz", "203.0.113.5:1", nil)
	if rec.Code != 200 {
		t.Fatalf("healthz: %d", rec.Code)
	}
}

func TestLoginPolicy(t *testing.T) {
	p := loginPolicy{FreeAttempts: 3, MaxFailures: 8, MaxIP: 30, Lockout: 15 * time.Minute, MaxBackoff: 5 * time.Minute}
	now := time.Unix(10000, 0)
	if w := p.retryAfter(3, p.MaxFailures, now, now); w != 0 {
		t.Fatalf("free attempts throttled: %d", w)
	}
	if w := p.retryAfter(4, p.MaxFailures, now, now); w != 1 {
		t.Fatalf("4th failure: %d", w)
	}
	if w := p.retryAfter(6, p.MaxFailures, now, now); w != 4 {
		t.Fatalf("6th failure: %d", w)
	}
	if w := p.retryAfter(6, p.MaxFailures, now.Add(-10*time.Second), now); w != 0 {
		t.Fatalf("backoff elapsed: %d", w)
	}
	if w := p.retryAfter(8, p.MaxFailures, now, now); w != 900 {
		t.Fatalf("lockout: %d", w)
	}
}
