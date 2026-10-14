package rpc

import (
	"testing"
)

func TestIsLoopbackHost(t *testing.T) {
	var trueCases = []string{
		"127.0.0.1",
		"127.0.0.1:8003",
		"127.0.0.2:8003",
		"localhost",
		"localhost:8003",
		"LOCALHOST:8003",
		"[::1]",
		"[::1]:8003",
	}
	for _, host := range trueCases {
		if !IsLoopbackHost(host) {
			t.Fatalf("expected '%s' to be treated as loopback", host)
		}
	}

	var falseCases = []string{
		"",
		"1.2.3.4",
		"1.2.3.4:8003",
		"example.com",
		"example.com:443",
		"192.168.1.5:8003",
		"0.0.0.0:8003",
		"[::]:8003",
		"api.goedge.local:8003",
	}
	for _, host := range falseCases {
		if IsLoopbackHost(host) {
			t.Fatalf("expected '%s' to NOT be treated as loopback", host)
		}
	}
}

func TestBuildTLSConfig_ServerName(t *testing.T) {
	config, err := BuildTLSConfig(nil, "api.example.com:8003")
	if err != nil {
		t.Fatal(err)
	}
	if config.ServerName != "api.example.com" {
		t.Fatalf("expected ServerName 'api.example.com', got '%s'", config.ServerName)
	}
	if config.RootCAs != nil {
		t.Fatal("expected nil RootCAs when no caFile is configured")
	}
}
