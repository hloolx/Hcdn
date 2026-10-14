package httpx

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
)

// CSRF cookie and header names (shared with web/packages/api/src/client.ts).
const (
	CSRFCookie = "hcdn_csrf"
	CSRFHeader = "X-CSRF-Token"
)

// RandomToken returns n random bytes, base64url without padding.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// CSRF implements the double-submit cookie plus an Origin/Referer check.
type CSRF struct {
	Secure bool
}

// Ensure sets the CSRF cookie when the request does not carry a valid one.
func (c *CSRF) Ensure(w http.ResponseWriter, r *http.Request) {
	if ck, err := r.Cookie(CSRFCookie); err == nil && validCSRFValue(ck.Value) {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookie,
		Value:    RandomToken(32),
		Path:     "/",
		Secure:   c.Secure,
		HttpOnly: false, // read by the SPA and echoed in X-CSRF-Token
		SameSite: http.SameSiteStrictMode,
	})
}

func validCSRFValue(v string) bool {
	if len(v) < 32 || len(v) > 128 {
		return false
	}
	for _, ch := range v {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

// SafeMethod reports methods that never need a CSRF token.
func SafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// Check validates an unsafe request; returns a 403 `csrf` error on failure.
func (c *CSRF) Check(r *http.Request) error {
	if SafeMethod(r.Method) {
		return nil
	}
	fail := Errorf(http.StatusForbidden, "csrf", "安全校验失败，请刷新页面后重试")
	if !SameOrigin(r) {
		return fail
	}
	ck, err := r.Cookie(CSRFCookie)
	if err != nil || !validCSRFValue(ck.Value) {
		return fail
	}
	hdr := r.Header.Get(CSRFHeader)
	if hdr == "" || subtle.ConstantTimeCompare([]byte(hdr), []byte(ck.Value)) != 1 {
		return fail
	}
	return nil
}

// SameOrigin checks that Origin (or, failing that, Referer) names the request host.
func SameOrigin(r *http.Request) bool {
	src := r.Header.Get("Origin")
	if src == "null" {
		return false // sandboxed/opaque origin
	}
	if src == "" {
		src = r.Header.Get("Referer")
	}
	if src == "" {
		return false
	}
	u, err := url.Parse(src)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}
