package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

func withIP(r *http.Request, ip string) *http.Request {
	return r.WithContext(withClientIP(r.Context(), netip.MustParseAddr(ip)))
}

func requireErrCode(t *testing.T, err error, code string) {
	t.Helper()
	var he *httpx.Error
	if !errors.As(err, &he) {
		t.Fatalf("expected *httpx.Error, got %#v", err)
	}
	if he.Code != code {
		t.Fatalf("code = %q, want %q (message: %s)", he.Code, code, he.Message)
	}
	if he.Status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", he.Status)
	}
}

func enableTurnstile(a *App) {
	a.cfg.Turnstile.SiteKey = "site-key"
	a.cfg.Turnstile.SecretKey = "secret-key"
}

func TestTurnstileSiteKeyHiddenWhenDisabled(t *testing.T) {
	a, _ := testApp(t)
	if got := a.turnstileSiteKey(); got != "" {
		t.Fatalf("siteKey = %q, want empty when disabled", got)
	}
	// Only one of the two keys set: still disabled, secret never leaks.
	a.cfg.Turnstile.SiteKey = "only-site"
	if a.turnstileEnabled() {
		t.Fatal("should stay disabled until both keys are set")
	}
	if got := a.turnstileSiteKey(); got != "" {
		t.Fatalf("siteKey = %q, want empty with only one key set", got)
	}
}

func TestTurnstileSiteKeyExposedWhenEnabled(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	if got := a.turnstileSiteKey(); got != "site-key" {
		t.Fatalf("siteKey = %q, want site-key", got)
	}
}

func TestVerifyTurnstileDisabledAlwaysPasses(t *testing.T) {
	a, _ := testApp(t)
	r := withIP(httptest.NewRequest("POST", "/", nil), "203.0.113.9")
	if err := a.verifyTurnstile(r, ""); err != nil {
		t.Fatalf("disabled must pass without a token: %v", err)
	}
}

func TestVerifyTurnstileMissingToken(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	r := withIP(httptest.NewRequest("POST", "/", nil), "203.0.113.9")
	err := a.verifyTurnstile(r, "   ")
	requireErrCode(t, err, "captcha_failed")
}

func TestVerifyTurnstileSuccess(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if got := r.FormValue("secret"); got != "secret-key" {
			t.Fatalf("secret = %q", got)
		}
		if got := r.FormValue("response"); got != "tok" {
			t.Fatalf("response = %q", got)
		}
		if got := r.FormValue("remoteip"); got != "203.0.113.9" {
			t.Fatalf("remoteip = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true})
	}))
	defer srv.Close()
	a.turnstileVerifyURL = srv.URL
	r := withIP(httptest.NewRequest("POST", "/", nil), "203.0.113.9")
	if err := a.verifyTurnstile(r, "tok"); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

func TestVerifyTurnstileRejected(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error-codes": []string{"invalid-input-response"}})
	}))
	defer srv.Close()
	a.turnstileVerifyURL = srv.URL
	r := withIP(httptest.NewRequest("POST", "/", nil), "203.0.113.9")
	err := a.verifyTurnstile(r, "bad-tok")
	requireErrCode(t, err, "captcha_failed")
}

func TestVerifyTurnstileUnavailableFailsClosed(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // connections are now refused
	a.turnstileVerifyURL = srv.URL
	r := withIP(httptest.NewRequest("POST", "/", nil), "203.0.113.9")
	err := a.verifyTurnstile(r, "tok")
	requireErrCode(t, err, "captcha_unavailable")
}

func TestVerifyTurnstileBadStatusFailsClosed(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	a.turnstileVerifyURL = srv.URL
	r := withIP(httptest.NewRequest("POST", "/", nil), "203.0.113.9")
	err := a.verifyTurnstile(r, "tok")
	requireErrCode(t, err, "captcha_unavailable")
}

// ---------------------------------------------------------------- wiring

// TestLoginChecksTurnstileBeforeLockout relies on testApp's store being nil:
// if the captcha check ran after checkLoginAllowed (which calls a.store.Failures),
// this would panic instead of returning a clean 400.
func TestLoginChecksTurnstileBeforeLockout(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"alice","password":"password1"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withIP(req, "203.0.113.9")
	rec := httptest.NewRecorder()
	a.h(a.login)(rec, req)
	assertCaptchaFailedBody(t, rec)
}

// TestRegisterChecksTurnstileBeforeEdgeCall relies on testApp's edge client
// being nil: if the captcha check ran after the EdgeAPI lookup, this would
// panic instead of returning a clean 400.
func TestRegisterChecksTurnstileBeforeEdgeCall(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	s := defaultRuntimeSettings(a.cfg)
	s.Registration.Open = true
	a.applySettings(s)
	req := httptest.NewRequest("POST", "/api/v1/auth/register",
		strings.NewReader(`{"username":"alice123","email":"alice@example.com","password":"password1"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	a.h(a.register)(rec, req)
	assertCaptchaFailedBody(t, rec)
}

func TestForgotPasswordChecksTurnstile(t *testing.T) {
	a, _ := testApp(t)
	enableTurnstile(a)
	req := httptest.NewRequest("POST", "/api/v1/auth/password/forgot", strings.NewReader(`{"email":"alice@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	a.h(a.forgotPassword)(rec, req)
	assertCaptchaFailedBody(t, rec)
}

func assertCaptchaFailedBody(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if body.Error.Code != "captcha_failed" {
		t.Fatalf("code = %q, want captcha_failed", body.Error.Code)
	}
}
