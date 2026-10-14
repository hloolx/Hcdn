// Package localconfig loads the optional node-local configuration file
// configs/local.yaml.
//
// The file is never written by edge-node and never synced from the API.
// A missing file means "all defaults", which is exactly the upstream behavior.
// It is read once at startup; changes require a restart.
package localconfig

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/iwind/TeaGo/Tea"
	"gopkg.in/yaml.v3"
)

const FileName = "local.yaml"

const DefaultProxyProtocolHeaderTimeout = 2 * time.Second

// DefaultProxyProtocolTrusted only allows PROXY protocol headers from loopback.
var DefaultProxyProtocolTrusted = []string{"127.0.0.1/32", "::1/128"}

// Config node-local configuration
type Config struct {
	Listen   ListenConfig   `yaml:"listen"`
	Firewall FirewallConfig `yaml:"firewall"`

	trustedNets   []*net.IPNet
	headerTimeout time.Duration
}

// ListenConfig listener related settings
type ListenConfig struct {
	Remap                      []*RemapConfig `yaml:"remap"`
	ProxyProtocolTrusted       []string       `yaml:"proxyProtocolTrusted"`
	ProxyProtocolHeaderTimeout string         `yaml:"proxyProtocolHeaderTimeout"`
}

// RemapConfig binds a configured (control-plane) TCP port on another local address
type RemapConfig struct {
	Port          int    `yaml:"port"`          // configured port, e.g. 443
	Addr          string `yaml:"addr"`          // actual bind address, e.g. 127.0.0.1:10443
	ProxyProtocol *bool  `yaml:"proxyProtocol"` // require PROXY protocol v1/v2 header, default true
}

// RequireProxyProtocol whether the remapped listener requires a PROXY protocol header
func (this *RemapConfig) RequireProxyProtocol() bool {
	return this.ProxyProtocol == nil || *this.ProxyProtocol
}

// FirewallConfig local firewall settings
type FirewallConfig struct {
	Kernel *bool `yaml:"kernel"` // false = never install kernel firewall rules, default true
}

// NewConfig returns a config with all defaults
func NewConfig() *Config {
	var config = &Config{}
	_ = config.Init()
	return config
}

// Parse parses and validates YAML data
func Parse(data []byte) (*Config, error) {
	var config = &Config{}
	var decoder = yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true) // reject typos such as 'kernal: false'
	err := decoder.Decode(config)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("decode '%s' failed: %w", FileName, err)
	}
	err = config.Init()
	if err != nil {
		return nil, fmt.Errorf("invalid '%s': %w", FileName, err)
	}
	return config, nil
}

// Load loads config from file; a missing file returns defaults
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return NewConfig(), nil
		}
		return nil, err
	}
	return Parse(data)
}

// Init validates the config and fills defaults
func (this *Config) Init() error {
	// remap
	var ports = map[int]bool{}
	for index, remap := range this.Listen.Remap {
		if remap == nil {
			return fmt.Errorf("listen.remap[%d]: empty item", index)
		}
		if remap.Port <= 0 || remap.Port > 65535 {
			return fmt.Errorf("listen.remap[%d]: invalid port '%d'", index, remap.Port)
		}
		if ports[remap.Port] {
			return fmt.Errorf("listen.remap[%d]: duplicate port '%d'", index, remap.Port)
		}
		ports[remap.Port] = true

		host, portString, err := net.SplitHostPort(remap.Addr)
		if err != nil {
			return fmt.Errorf("listen.remap[%d]: invalid addr '%s': %w", index, remap.Addr, err)
		}
		bindPort, err := strconv.Atoi(portString)
		if err != nil || bindPort <= 0 || bindPort > 65535 {
			return fmt.Errorf("listen.remap[%d]: invalid port in addr '%s'", index, remap.Addr)
		}
		if len(host) > 0 && net.ParseIP(host) == nil {
			return fmt.Errorf("listen.remap[%d]: host in addr '%s' must be an IP", index, remap.Addr)
		}
	}

	// trusted sources
	var trusted = this.Listen.ProxyProtocolTrusted
	if len(trusted) == 0 {
		trusted = DefaultProxyProtocolTrusted
	}
	this.trustedNets = nil
	for _, s := range trusted {
		ipNet, err := ParseCIDR(s)
		if err != nil {
			return fmt.Errorf("listen.proxyProtocolTrusted: %w", err)
		}
		this.trustedNets = append(this.trustedNets, ipNet)
	}

	// header timeout
	this.headerTimeout = DefaultProxyProtocolHeaderTimeout
	if len(this.Listen.ProxyProtocolHeaderTimeout) > 0 {
		d, err := time.ParseDuration(this.Listen.ProxyProtocolHeaderTimeout)
		if err != nil || d <= 0 {
			return fmt.Errorf("listen.proxyProtocolHeaderTimeout: invalid duration '%s'", this.Listen.ProxyProtocolHeaderTimeout)
		}
		this.headerTimeout = d
	}

	return nil
}

// FindRemap finds the remap entry for a configured TCP port, nil if the port is not remapped
func (this *Config) FindRemap(port int) *RemapConfig {
	if this == nil {
		return nil
	}
	for _, remap := range this.Listen.Remap {
		if remap.Port == port {
			return remap
		}
	}
	return nil
}

// FindRemapForAddr finds the remap entry for a configured listen address such as ':443' or '[::]:443'
func (this *Config) FindRemapForAddr(addr string) *RemapConfig {
	_, portString, err := net.SplitHostPort(addr)
	if err != nil {
		return nil
	}
	port, err := strconv.Atoi(portString)
	if err != nil {
		return nil
	}
	return this.FindRemap(port)
}

// TrustedNets networks allowed to send PROXY protocol headers
func (this *Config) TrustedNets() []*net.IPNet {
	return this.trustedNets
}

// ProxyProtocolHeaderTimeout max time to wait for a PROXY protocol header
func (this *Config) ProxyProtocolHeaderTimeout() time.Duration {
	if this.headerTimeout <= 0 {
		return DefaultProxyProtocolHeaderTimeout
	}
	return this.headerTimeout
}

// KernelFirewallEnabled whether edge-node may install kernel firewall rules (nftables/firewalld etc.)
func (this *Config) KernelFirewallEnabled() bool {
	if this == nil {
		return true
	}
	return this.Firewall.Kernel == nil || *this.Firewall.Kernel
}

// IsTrusted checks whether an IP belongs to one of the networks
func IsTrusted(nets []*net.IPNet, ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	}
	for _, ipNet := range nets {
		if ipNet.Contains(ip) {
			return true
		}
	}
	return false
}

// ParseCIDR parses a CIDR or a single IP
func ParseCIDR(s string) (*net.IPNet, error) {
	s = strings.TrimSpace(s)
	if !strings.Contains(s, "/") {
		var ip = net.ParseIP(s)
		if ip == nil {
			return nil, fmt.Errorf("invalid IP or CIDR '%s'", s)
		}
		if ip4 := ip.To4(); ip4 != nil {
			return &net.IPNet{IP: ip4, Mask: net.CIDRMask(32, 32)}, nil
		}
		return &net.IPNet{IP: ip, Mask: net.CIDRMask(128, 128)}, nil
	}
	_, ipNet, err := net.ParseCIDR(s)
	if err != nil {
		return nil, fmt.Errorf("invalid IP or CIDR '%s'", s)
	}
	return ipNet, nil
}

var sharedConfig *Config
var sharedErr error
var sharedOnce sync.Once

// Shared loads configs/local.yaml once and returns it.
// On error a default config is returned together with the error.
func Shared() (*Config, error) {
	sharedOnce.Do(func() {
		sharedConfig, sharedErr = Load(Tea.ConfigFile(FileName))
		if sharedErr != nil {
			sharedConfig = NewConfig()
		}
	})
	return sharedConfig, sharedErr
}

// SharedConfig returns the shared config, ignoring load errors (defaults are used then)
func SharedConfig() *Config {
	config, _ := Shared()
	return config
}
