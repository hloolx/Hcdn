package httpx

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClientIP(t *testing.T) {
	r := &IPResolver{Trusted: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("127.0.0.1/32")}}
	cases := []struct {
		peer, xff, want string
	}{
		{"203.0.113.9:1234", "", "203.0.113.9"},
		{"203.0.113.9:1234", "198.51.100.1", "203.0.113.9"},                   // untrusted peer: XFF ignored
		{"127.0.0.1:5555", "198.51.100.1", "198.51.100.1"},                    // trusted proxy
		{"127.0.0.1:5555", "1.1.1.1, 198.51.100.1, 10.1.2.3", "198.51.100.1"}, // skip trusted hops, ignore spoofed left part
		{"127.0.0.1:5555", "garbage, 198.51.100.7", "198.51.100.7"},
		{"127.0.0.1:5555", "10.0.0.5", "10.0.0.5"}, // only trusted hops: left-most seen
		{"[::ffff:127.0.0.1]:80", "[2001:db8::1]:443", "2001:db8::1"},
		{"127.0.0.1:5555", "", "127.0.0.1"},
	}
	for _, c := range cases {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = c.peer
		if c.xff != "" {
			req.Header.Set("X-Forwarded-For", c.xff)
		}
		if got := r.ClientIP(req).String(); got != c.want {
			t.Errorf("peer=%s xff=%q: got %s want %s", c.peer, c.xff, got, c.want)
		}
	}
	// X-Forwarded-Proto only from trusted peers.
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "203.0.113.9:1"
	req.Header.Set("X-Forwarded-Proto", "https")
	if r.IsTLS(req) {
		t.Error("untrusted X-Forwarded-Proto honoured")
	}
	req.RemoteAddr = "10.9.9.9:1"
	if !r.IsTLS(req) {
		t.Error("trusted X-Forwarded-Proto ignored")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(1, 3) // 1 token/s, burst 3
	now := time.Unix(1000, 0)
	l.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		if ok, _ := l.Allow("k"); !ok {
			t.Fatalf("request %d denied within burst", i)
		}
	}
	ok, wait := l.Allow("k")
	if ok || wait != 1 {
		t.Fatalf("expected denial with wait 1, got ok=%v wait=%d", ok, wait)
	}
	if ok, _ := l.Allow("other"); !ok {
		t.Fatal("keys must be independent")
	}
	now = now.Add(1500 * time.Millisecond)
	if ok, _ := l.Allow("k"); !ok {
		t.Fatal("token not refilled")
	}
	if ok, _ := l.Allow("k"); ok {
		t.Fatal("only one token should have been refilled")
	}
	now = now.Add(time.Hour)
	l.Allow("x") // triggers gc
	if l.Len() != 1 {
		t.Fatalf("idle buckets not collected: %d", l.Len())
	}
}

func TestCSRF(t *testing.T) {
	c := &CSRF{Secure: true}
	// Ensure sets a cookie when missing.
	rec := httptest.NewRecorder()
	c.Ensure(rec, httptest.NewRequest("GET", "https://console.example.com/", nil))
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != CSRFCookie || cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("bad csrf cookie %+v", cookies)
	}
	tok := cookies[0].Value
	// Ensure keeps an existing valid cookie.
	rec = httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: CSRFCookie, Value: tok})
	c.Ensure(rec, req)
	if len(rec.Result().Cookies()) != 0 {
		t.Fatal("cookie re-issued")
	}

	mk := func(method, origin, referer, header, cookie string) *http.Request {
		r := httptest.NewRequest(method, "https://console.example.com/api/v1/x", strings.NewReader("{}"))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if referer != "" {
			r.Header.Set("Referer", referer)
		}
		if header != "" {
			r.Header.Set(CSRFHeader, header)
		}
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: CSRFCookie, Value: cookie})
		}
		return r
	}
	const o = "https://console.example.com"
	cases := []struct {
		name string
		req  *http.Request
		ok   bool
	}{
		{"get needs nothing", mk("GET", "", "", "", ""), true},
		{"valid", mk("POST", o, "", tok, tok), true},
		{"valid via referer", mk("DELETE", "", o+"/sites", tok, tok), true},
		{"missing header", mk("POST", o, "", "", tok), false},
		{"mismatch", mk("POST", o, "", tok+"x", tok), false},
		{"no cookie", mk("POST", o, "", tok, ""), false},
		{"cross origin", mk("POST", "https://evil.example", "", tok, tok), false},
		{"null origin", mk("POST", "null", o, tok, tok), false},
		{"no origin or referer", mk("PUT", "", "", tok, tok), false},
	}
	for _, cs := range cases {
		err := c.Check(cs.req)
		if (err == nil) != cs.ok {
			t.Errorf("%s: err=%v", cs.name, err)
		}
		if err != nil && err.(*Error).Code != "csrf" {
			t.Errorf("%s: code %s", cs.name, err.(*Error).Code)
		}
	}
}

func TestSPA(t *testing.T) {
	dir := t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>root</html>"), 0o644))
	must(os.MkdirAll(filepath.Join(dir, "assets"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "assets", "app-abc123.js"), []byte("js"), 0o644))
	must(os.WriteFile(filepath.Join(dir, "favicon.svg"), []byte("<svg/>"), 0o644))
	must(os.MkdirAll(filepath.Join(dir, "pricing"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "pricing", "index.html"), []byte("pricing"), 0o644))
	spa, err := NewSPA(dir)
	must(err)
	defer spa.Close()

	get := func(p string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		spa.ServeHTTP(rec, httptest.NewRequest("GET", p, nil))
		return rec
	}
	if r := get("/"); r.Code != 200 || !strings.Contains(r.Body.String(), "root") || r.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("/: %d %q %q", r.Code, r.Body.String(), r.Header().Get("Cache-Control"))
	}
	if r := get("/sites/12/settings"); r.Code != 200 || !strings.Contains(r.Body.String(), "root") {
		t.Fatalf("SPA fallback failed: %d", r.Code)
	}
	if r := get("/assets/app-abc123.js"); r.Code != 200 || !strings.Contains(r.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset: %d %q", r.Code, r.Header().Get("Cache-Control"))
	}
	if r := get("/assets/missing.js"); r.Code != 404 {
		t.Fatalf("missing asset should 404, got %d", r.Code)
	}
	if r := get("/missing.png"); r.Code != 404 {
		t.Fatalf("missing file with extension should 404, got %d", r.Code)
	}
	if r := get("/pricing"); r.Code != 200 || r.Body.String() != "pricing" {
		t.Fatalf("directory index: %d %q", r.Code, r.Body.String())
	}
	if r := get("/../../etc/passwd"); r.Code != 200 || !strings.Contains(r.Body.String(), "root") {
		t.Fatalf("traversal should fall back to index, got %d", r.Code)
	}
	rec := httptest.NewRecorder()
	spa.ServeHTTP(rec, httptest.NewRequest("POST", "/", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: %d", rec.Code)
	}
}
