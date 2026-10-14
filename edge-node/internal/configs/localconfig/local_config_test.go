package localconfig_test

import (
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/TeaOSLab/EdgeNode/internal/configs/localconfig"
)

func TestLoad_Missing(t *testing.T) {
	config, err := localconfig.Load(filepath.Join(t.TempDir(), "local.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if config.FindRemap(443) != nil {
		t.Fatal("expected no remap")
	}
	if !config.KernelFirewallEnabled() {
		t.Fatal("kernel firewall should be enabled by default")
	}
	if config.ProxyProtocolHeaderTimeout() != localconfig.DefaultProxyProtocolHeaderTimeout {
		t.Fatal("unexpected default timeout")
	}
	if !localconfig.IsTrusted(config.TrustedNets(), net.ParseIP("127.0.0.1")) ||
		!localconfig.IsTrusted(config.TrustedNets(), net.ParseIP("::1")) ||
		localconfig.IsTrusted(config.TrustedNets(), net.ParseIP("192.0.2.1")) {
		t.Fatal("default trusted sources should be loopback only")
	}
}

func TestLoad_Empty(t *testing.T) {
	var path = filepath.Join(t.TempDir(), "local.yaml")
	if err := os.WriteFile(path, []byte("# nothing\n"), 0644); err != nil {
		t.Fatal(err)
	}
	config, err := localconfig.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !config.KernelFirewallEnabled() || len(config.Listen.Remap) != 0 {
		t.Fatal("empty file should mean defaults")
	}
}

func TestParse(t *testing.T) {
	config, err := localconfig.Parse([]byte(`
listen:
  remap:
    - port: 443
      addr: "127.0.0.1:10443"
    - port: 8443
      addr: "[::1]:18443"
      proxyProtocol: false
  proxyProtocolTrusted: ["127.0.0.1", "198.51.100.0/24"]
  proxyProtocolHeaderTimeout: 500ms
firewall:
  kernel: false
`))
	if err != nil {
		t.Fatal(err)
	}

	var remap = config.FindRemapForAddr(":443")
	if remap == nil || remap.Addr != "127.0.0.1:10443" || !remap.RequireProxyProtocol() {
		t.Fatalf("unexpected remap for :443: %+v", remap)
	}
	remap = config.FindRemapForAddr("[::]:8443")
	if remap == nil || remap.RequireProxyProtocol() {
		t.Fatalf("unexpected remap for 8443: %+v", remap)
	}
	if config.FindRemapForAddr(":80") != nil {
		t.Fatal("port 80 should not be remapped")
	}
	if config.KernelFirewallEnabled() {
		t.Fatal("kernel firewall should be disabled")
	}
	if config.ProxyProtocolHeaderTimeout() != 500*time.Millisecond {
		t.Fatal("unexpected timeout")
	}
	var nets = config.TrustedNets()
	if !localconfig.IsTrusted(nets, net.ParseIP("198.51.100.7")) ||
		!localconfig.IsTrusted(nets, net.ParseIP("::ffff:127.0.0.1")) ||
		localconfig.IsTrusted(nets, net.ParseIP("127.0.0.2")) ||
		localconfig.IsTrusted(nets, net.ParseIP("::1")) {
		t.Fatal("unexpected trusted result")
	}
}

func TestParse_Invalid(t *testing.T) {
	for _, data := range []string{
		"listen:\n  remap:\n    - port: 0\n      addr: \"127.0.0.1:10443\"\n",
		"listen:\n  remap:\n    - port: 443\n      addr: \"127.0.0.1\"\n",
		"listen:\n  remap:\n    - port: 443\n      addr: \"localhost:10443\"\n",
		"listen:\n  remap:\n    - port: 443\n      addr: \"127.0.0.1:1\"\n    - port: 443\n      addr: \"127.0.0.1:2\"\n",
		"listen:\n  proxyProtocolTrusted: [\"not-an-ip\"]\n",
		"listen:\n  proxyProtocolHeaderTimeout: 2\n",
		"firewall:\n  kernal: false\n", // typo must not be silently ignored
	} {
		_, err := localconfig.Parse([]byte(data))
		if err == nil {
			t.Fatalf("expected error for:\n%s", data)
		}
		t.Log(err)
	}
}
