package rpcutils_test

import (
	"github.com/TeaOSLab/EdgeNode/internal/utils/rpcutils"
	"testing"
)

func TestValidateEndpoint_HTTPS(t *testing.T) {
	var cases = []string{
		"https://api.example.com:8003",
		"https://203.0.113.10:8003",
		"https://127.0.0.1:8003",
		"https://[::1]:8003",
	}
	for _, endpoint := range cases {
		if err := rpcutils.ValidateEndpoint(endpoint); err != nil {
			t.Fatalf("expected %q to be valid, got error: %v", endpoint, err)
		}
	}
}

func TestValidateEndpoint_HTTPLoopback(t *testing.T) {
	var cases = []string{
		"http://127.0.0.1:8003",
		"http://127.8.8.8:8003", // still within 127.0.0.0/8
		"http://localhost:8003",
		"http://[::1]:8003",
	}
	for _, endpoint := range cases {
		if err := rpcutils.ValidateEndpoint(endpoint); err != nil {
			t.Fatalf("expected %q (loopback http) to be valid, got error: %v", endpoint, err)
		}
	}
}

func TestValidateEndpoint_HTTPNonLoopbackRejected(t *testing.T) {
	var cases = []string{
		"http://203.0.113.10:8003",
		"http://api.example.com:8003",
		"http://192.168.1.1:8003",
		"http://0.0.0.0:8003",
	}
	for _, endpoint := range cases {
		if err := rpcutils.ValidateEndpoint(endpoint); err == nil {
			t.Fatalf("expected %q (non-loopback http) to be rejected", endpoint)
		}
	}
}

func TestValidateEndpoint_InvalidScheme(t *testing.T) {
	var cases = []string{
		"ftp://127.0.0.1:8003",
		"ws://127.0.0.1:8003",
		"127.0.0.1:8003", // no scheme at all
	}
	for _, endpoint := range cases {
		if err := rpcutils.ValidateEndpoint(endpoint); err == nil {
			t.Fatalf("expected %q to be rejected (invalid/missing scheme)", endpoint)
		}
	}
}

func TestValidateEndpoint_Malformed(t *testing.T) {
	if err := rpcutils.ValidateEndpoint("https://%zz"); err == nil {
		t.Fatal("expected malformed endpoint to be rejected")
	}
	if err := rpcutils.ValidateEndpoint("https://"); err == nil {
		t.Fatal("expected endpoint with empty host to be rejected")
	}
}

func TestEndpointIsAllowed(t *testing.T) {
	var allowed = []string{"https://10.0.0.1:8003", "https://10.0.0.2:8003"}

	if !rpcutils.EndpointIsAllowed("https://10.0.0.1:8003", allowed) {
		t.Fatal("expected an endpoint present in the list to be allowed")
	}
	if rpcutils.EndpointIsAllowed("https://10.0.0.3:8003", allowed) {
		t.Fatal("expected an endpoint not present in the list to be rejected")
	}
	if rpcutils.EndpointIsAllowed("https://10.0.0.1:9999", allowed) {
		t.Fatal("expected matching to be exact (same host, different port must not match)")
	}
	if rpcutils.EndpointIsAllowed("http://10.0.0.1:8003", allowed) {
		t.Fatal("expected matching to be exact (same host:port, different scheme must not match)")
	}
	if rpcutils.EndpointIsAllowed("https://10.0.0.1:8003", nil) {
		t.Fatal("expected an empty allowlist to allow nothing")
	}
}

func TestIsLoopbackHost(t *testing.T) {
	var loopback = []string{"127.0.0.1", "127.1.2.3", "::1", "localhost"}
	for _, host := range loopback {
		if !rpcutils.IsLoopbackHost(host) {
			t.Fatalf("expected %q to be loopback", host)
		}
	}

	var notLoopback = []string{"203.0.113.10", "192.168.1.1", "10.0.0.1", "example.com", ""}
	for _, host := range notLoopback {
		if rpcutils.IsLoopbackHost(host) {
			t.Fatalf("expected %q to not be loopback", host)
		}
	}
}
