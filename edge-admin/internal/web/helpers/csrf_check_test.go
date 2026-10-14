package helpers

import (
	"github.com/iwind/TeaGo/actions"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckCSRF(t *testing.T) {
	var token = GenerateCSRFToken()
	if len(token) == 0 {
		t.Fatal("expected a non-empty token")
	}

	var reqWithToken = httptest.NewRequest(http.MethodPost, "http://admin.example.com/admins/delete", nil)
	reqWithToken.Header.Set(CSRFHeaderName, token)
	if !CheckCSRF(&actions.ActionObject{Request: reqWithToken}) {
		t.Fatal("expected CheckCSRF() to succeed with a freshly generated token in the header")
	}

	// Peek()不消费，重复校验同一个请求仍然应该成功
	if !CheckCSRF(&actions.ActionObject{Request: reqWithToken}) {
		t.Fatal("expected a second CheckCSRF() with the same token to still succeed (non-consuming)")
	}

	var reqWithoutToken = httptest.NewRequest(http.MethodPost, "http://admin.example.com/admins/delete", nil)
	if CheckCSRF(&actions.ActionObject{Request: reqWithoutToken}) {
		t.Fatal("expected CheckCSRF() to fail when no header is present")
	}

	var reqWithBadToken = httptest.NewRequest(http.MethodPost, "http://admin.example.com/admins/delete", nil)
	reqWithBadToken.Header.Set(CSRFHeaderName, "not-a-real-token")
	if CheckCSRF(&actions.ActionObject{Request: reqWithBadToken}) {
		t.Fatal("expected CheckCSRF() to fail with a bogus header value")
	}
}

func TestCheckCSRFOrigin(t *testing.T) {
	newRequest := func(host, origin, referer string) *http.Request {
		var req = httptest.NewRequest(http.MethodPost, "http://"+host+"/admins/delete", nil)
		req.Host = host
		if len(origin) > 0 {
			req.Header.Set("Origin", origin)
		}
		if len(referer) > 0 {
			req.Header.Set("Referer", referer)
		}
		return req
	}

	var cases = []struct {
		name    string
		host    string
		origin  string
		referer string
		want    bool
	}{
		{"no origin no referer", "admin.example.com", "", "", true},
		{"matching origin", "admin.example.com", "https://admin.example.com", "", true},
		{"matching origin with port", "admin.example.com:7788", "https://admin.example.com:7788", "", true},
		{"mismatched origin", "admin.example.com", "https://evil.example.com", "", false},
		{"matching referer, no origin", "admin.example.com", "", "https://admin.example.com/admins", true},
		{"mismatched referer, no origin", "admin.example.com", "", "https://evil.example.com/attack", false},
		{"origin wins over mismatched referer", "admin.example.com", "https://admin.example.com", "https://evil.example.com/attack", true},
		{"malformed origin", "admin.example.com", "http://[::1", "", false},
	}

	for _, c := range cases {
		var req = newRequest(c.host, c.origin, c.referer)
		var got = CheckCSRFOrigin(req)
		if got != c.want {
			t.Errorf("%s: CheckCSRFOrigin() = %v, want %v", c.name, got, c.want)
		}
	}
}
