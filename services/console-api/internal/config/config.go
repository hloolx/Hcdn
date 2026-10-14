// Package config loads configs/console-api.yaml.
package config

import (
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strings"
	"time"

	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"gopkg.in/yaml.v3"
)

// Config is the whole console-api configuration.
type Config struct {
	Listen string `yaml:"listen"`
	TLS    struct {
		CertFile string `yaml:"certFile"`
		KeyFile  string `yaml:"keyFile"`
	} `yaml:"tls"`
	// TrustedProxies are CIDRs whose X-Forwarded-For / X-Forwarded-Proto are honoured.
	TrustedProxies []string `yaml:"trustedProxies"`
	Hosts          Hosts    `yaml:"hosts"`
	Static         struct {
		Site    string `yaml:"site"`
		Console string `yaml:"console"`
		Admin   string `yaml:"admin"`
	} `yaml:"static"`
	EdgeAPI struct {
		Endpoints  []string           `yaml:"endpoints"`
		CAFile     string             `yaml:"caFile"`
		ServerName string             `yaml:"serverName"`
		User       edgeapi.Credential `yaml:"user"`
		Admin      edgeapi.Credential `yaml:"admin"`
		// AdminID is the EdgeAPI admin id used for the few customer flows that need
		// admin rights (default cluster lookup at signup, quotas). Default 1.
		AdminID int64 `yaml:"adminId"`
	} `yaml:"edgeAPI"`
	DB struct {
		DSN string `yaml:"dsn"`
	} `yaml:"db"`
	Cookie struct {
		Secure *bool `yaml:"secure"`
	} `yaml:"cookie"`
	AdminIPAllowlist []string     `yaml:"adminIpAllowlist"`
	SMTP             SMTP         `yaml:"smtp"`
	Registration     Registration `yaml:"registration"`
	CNAMEDomain      string       `yaml:"cnameDomain"`
	ProductName      string       `yaml:"productName"`
	ConsoleURL       string       `yaml:"consoleUrl"`
	Plans            []Plan       `yaml:"plans"`
	// DefaultPlan is the plan id shown for customers (Me.plan). Defaults to the first plan.
	DefaultPlan string `yaml:"defaultPlan"`
	RateLimit   struct {
		// Global per-IP requests per second (burst = 4x).
		GlobalRPS float64 `yaml:"globalRps"`
		// /auth/* per-IP requests per minute (burst = same value).
		AuthPerMinute float64 `yaml:"authPerMinute"`
	} `yaml:"rateLimit"`
	Login struct {
		WindowMinutes  int `yaml:"windowMinutes"`
		MaxFailures    int `yaml:"maxFailures"`
		MaxIPFailures  int `yaml:"maxIpFailures"`
		LockoutMinutes int `yaml:"lockoutMinutes"`
	} `yaml:"login"`
	Log struct {
		Level  string `yaml:"level"`
		Format string `yaml:"format"` // "text" | "json"
	} `yaml:"log"`

	path string
}

// Hosts maps Host headers to front ends.
type Hosts struct {
	Site    []string `yaml:"site"`
	Console []string `yaml:"console"`
	Admin   []string `yaml:"admin"`
	API     []string `yaml:"api"`
}

// SMTP is the optional mail relay.
type SMTP struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	From     string `yaml:"from"`
	// TLS: "starttls" (default, port 587), "tls" (implicit, port 465) or "none" (loopback relays only).
	TLS string `yaml:"tls"`
}

// Configured reports whether mail can be sent.
func (s SMTP) Configured() bool { return s.Host != "" && s.From != "" }

// Registration controls self-service signup.
type Registration struct {
	Open                     bool  `yaml:"open"`
	DefaultClusterID         int64 `yaml:"defaultClusterId"`
	RequireEmailVerification bool  `yaml:"requireEmailVerification"`
}

// Plan is a static marketing plan.
type Plan struct {
	ID                string   `yaml:"id" json:"id"`
	Name              string   `yaml:"name" json:"name"`
	PriceMonthly      *float64 `yaml:"priceMonthly" json:"priceMonthly"`
	Currency          string   `yaml:"currency" json:"currency"`
	TrafficQuotaBytes *int64   `yaml:"trafficQuotaBytes" json:"trafficQuotaBytes"`
	DomainsQuota      *int64   `yaml:"domainsQuota" json:"domainsQuota"`
	Features          []string `yaml:"features" json:"features"`
	Highlight         bool     `yaml:"highlight" json:"highlight"`
}

// Load reads and validates the config file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	c := &Config{}
	if err := yaml.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	c.path = path
	c.applyDefaults()
	if err := c.validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// Path returns the file the config was loaded from.
func (c *Config) Path() string { return c.path }

func (c *Config) applyDefaults() {
	if c.Listen == "" {
		c.Listen = "127.0.0.1:18080"
	}
	if c.ProductName == "" {
		c.ProductName = "Hcdn"
	}
	if c.EdgeAPI.AdminID <= 0 {
		c.EdgeAPI.AdminID = 1
	}
	if c.RateLimit.GlobalRPS <= 0 {
		c.RateLimit.GlobalRPS = 30
	}
	if c.RateLimit.AuthPerMinute <= 0 {
		c.RateLimit.AuthPerMinute = 20
	}
	if c.Login.WindowMinutes <= 0 {
		c.Login.WindowMinutes = 15
	}
	if c.Login.MaxFailures <= 0 {
		c.Login.MaxFailures = 8
	}
	if c.Login.MaxIPFailures <= 0 {
		c.Login.MaxIPFailures = 30
	}
	if c.Login.LockoutMinutes <= 0 {
		c.Login.LockoutMinutes = 15
	}
	if c.SMTP.Port == 0 {
		switch c.SMTP.TLS {
		case "tls":
			c.SMTP.Port = 465
		default:
			c.SMTP.Port = 587
		}
	}
	if c.SMTP.TLS == "" {
		c.SMTP.TLS = "starttls"
	}
	for i, p := range c.Plans {
		if p.Currency == "" {
			c.Plans[i].Currency = "CNY"
		}
		if p.Features == nil {
			c.Plans[i].Features = []string{}
		}
	}
	lower := func(in []string) []string {
		out := make([]string, 0, len(in))
		for _, h := range in {
			if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
				out = append(out, h)
			}
		}
		return out
	}
	c.Hosts.Site = lower(c.Hosts.Site)
	c.Hosts.Console = lower(c.Hosts.Console)
	c.Hosts.Admin = lower(c.Hosts.Admin)
	c.Hosts.API = lower(c.Hosts.API)
}

func (c *Config) validate() error {
	var errs []error
	if c.DB.DSN == "" {
		errs = append(errs, errors.New("db.dsn is required"))
	}
	if len(c.EdgeAPI.Endpoints) == 0 {
		errs = append(errs, errors.New("edgeAPI.endpoints is required"))
	}
	if (c.TLS.CertFile == "") != (c.TLS.KeyFile == "") {
		errs = append(errs, errors.New("tls.certFile and tls.keyFile must be set together"))
	}
	if _, err := ParsePrefixes(c.TrustedProxies); err != nil {
		errs = append(errs, fmt.Errorf("trustedProxies: %w", err))
	}
	if _, err := ParsePrefixes(c.AdminIPAllowlist); err != nil {
		errs = append(errs, fmt.Errorf("adminIpAllowlist: %w", err))
	}
	switch c.SMTP.TLS {
	case "starttls", "tls", "none":
	default:
		errs = append(errs, errors.New("smtp.tls must be starttls, tls or none"))
	}
	return errors.Join(errs...)
}

// CookieSecure returns the Secure flag for cookies (default true).
func (c *Config) CookieSecure() bool {
	if c.Cookie.Secure == nil {
		return true
	}
	return *c.Cookie.Secure
}

// LoginWindow is the brute-force sliding window.
func (c *Config) LoginWindow() time.Duration {
	return time.Duration(c.Login.WindowMinutes) * time.Minute
}

// ParsePrefixes parses CIDRs or bare IPs.
func ParsePrefixes(list []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(list))
	for _, s := range list {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if strings.Contains(s, "/") {
			p, err := netip.ParsePrefix(s)
			if err != nil {
				return nil, err
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(s)
		if err != nil {
			return nil, err
		}
		a = a.Unmap()
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	return out, nil
}
