package dnsclients

import (
	"net/http"
	"testing"

	"github.com/iwind/TeaGo/maps"
)

func TestCloudFlareAuthHeaders(t *testing.T) {
	h := http.Header{}
	setCloudFlareAuthHeaders(h, "tok", "key", "a@example.com")
	if h.Get("Authorization") != "Bearer tok" || h.Get("X-Auth-Key") != "" {
		t.Fatalf("token mode headers wrong: %v", h)
	}
	h = http.Header{}
	setCloudFlareAuthHeaders(h, "", "key", "a@example.com")
	if h.Get("Authorization") != "" || h.Get("X-Auth-Key") != "key" || h.Get("X-Auth-Email") != "a@example.com" {
		t.Fatalf("legacy headers wrong: %v", h)
	}
}

func TestCloudFlareAuthParams(t *testing.T) {
	p := &CloudFlareProvider{}
	if err := p.Auth(maps.Map{"apiToken": "tok"}); err != nil {
		t.Fatalf("token only should be accepted: %v", err)
	}
	if err := p.Auth(maps.Map{"apiKey": "key"}); err == nil {
		t.Fatal("apiKey without email must be rejected")
	}
	if err := p.Auth(maps.Map{}); err == nil {
		t.Fatal("empty params must be rejected")
	}
}
