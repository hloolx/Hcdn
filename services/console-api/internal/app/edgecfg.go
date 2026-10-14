package app

import (
	"encoding/json"
	"strconv"
	"strings"
)

// JSON shapes of EdgeCommon serverconfigs that console-api reads or writes.
// Only the fields we need are modelled; unknown fields are preserved where we
// do read-modify-write (see rawObject).

type serverName struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	SubNames []string `json:"subNames"`
}

func serverNamesJSON(domains []string) []byte {
	out := make([]serverName, 0, len(domains))
	for _, d := range domains {
		out = append(out, serverName{Name: d, Type: "full", SubNames: []string{}})
	}
	data, _ := json.Marshal(out)
	return data
}

func parseServerNames(data []byte) []string {
	var names []serverName
	_ = json.Unmarshal(data, &names)
	out := []string{}
	for _, n := range names {
		if len(n.SubNames) > 0 {
			out = append(out, n.SubNames...)
		} else if n.Name != "" {
			out = append(out, n.Name)
		}
	}
	return out
}

type netAddr struct {
	Protocol  string `json:"protocol"`
	Host      string `json:"host"`
	PortRange string `json:"portRange"`
}

type protocolConfig struct {
	IsOn         bool           `json:"isOn"`
	Listen       []netAddr      `json:"listen"`
	SSLPolicyRef *sslPolicyRef  `json:"sslPolicyRef,omitempty"`
	SSLPolicy    map[string]any `json:"sslPolicy,omitempty"`
}

type sslPolicyRef struct {
	IsOn        bool  `json:"isOn"`
	SSLPolicyID int64 `json:"sslPolicyId"`
}

func httpJSON() []byte {
	data, _ := json.Marshal(protocolConfig{IsOn: true, Listen: []netAddr{{Protocol: "http", PortRange: "80"}}})
	return data
}

func httpsJSON(on bool, policyID int64) []byte {
	pc := protocolConfig{IsOn: on, Listen: []netAddr{{Protocol: "https", PortRange: "443"}}}
	if policyID > 0 {
		pc.SSLPolicyRef = &sslPolicyRef{IsOn: true, SSLPolicyID: policyID}
	}
	data, _ := json.Marshal(pc)
	return data
}

func parseProtocol(data []byte) protocolConfig {
	var pc protocolConfig
	_ = json.Unmarshal(data, &pc)
	return pc
}

type reverseProxyRef struct {
	IsPrior        bool  `json:"isPrior"`
	IsOn           bool  `json:"isOn"`
	ReverseProxyID int64 `json:"reverseProxyId"`
}

type originRef struct {
	IsOn     bool  `json:"isOn"`
	OriginID int64 `json:"originId"`
}

type originConfig struct {
	ID     int64   `json:"id"`
	IsOn   bool    `json:"isOn"`
	Addr   netAddr `json:"addr"`
	Weight int     `json:"weight"`
}

// reverseProxyConfig is serverconfigs.ReverseProxyConfig (subset + passthrough).
type reverseProxyConfig struct {
	ID                       int64           `json:"id"`
	IsOn                     bool            `json:"isOn"`
	PrimaryOrigins           []originConfig  `json:"primaryOrigins"`
	RequestHostType          int32           `json:"requestHostType"`
	RequestHost              string          `json:"requestHost"`
	RequestHostExcludingPort bool            `json:"requestHostExcludingPort"`
	RequestURI               string          `json:"requestURI"`
	StripPrefix              string          `json:"stripPrefix"`
	AutoFlush                bool            `json:"autoFlush"`
	AddHeaders               []string        `json:"addHeaders"`
	ConnTimeout              json.RawMessage `json:"connTimeout"`
	ReadTimeout              json.RawMessage `json:"readTimeout"`
	IdleTimeout              json.RawMessage `json:"idleTimeout"`
	MaxConns                 int32           `json:"maxConns"`
	MaxIdleConns             int32           `json:"maxIdleConns"`
	ProxyProtocol            json.RawMessage `json:"proxyProtocol"`
	FollowRedirects          bool            `json:"followRedirects"`
	Retry50X                 bool            `json:"retry50X"`
	Retry40X                 bool            `json:"retry40X"`
}

func rawOrNil(r json.RawMessage) []byte {
	if len(r) == 0 || string(r) == "null" {
		return nil
	}
	return r
}

// webConfig is the subset of serverconfigs.HTTPWebConfig we read.
type webConfig struct {
	ID              int64           `json:"id"`
	Cache           json.RawMessage `json:"cache"`
	RedirectToHTTPS *struct {
		IsOn bool `json:"isOn"`
	} `json:"redirectToHTTPS"`
	FirewallRef *firewallRef `json:"firewallRef"`
}

type firewallRef struct {
	IsPrior           bool  `json:"isPrior"`
	IsOn              bool  `json:"isOn"`
	FirewallPolicyID  int64 `json:"firewallPolicyId"`
	IgnoreGlobalRules bool  `json:"ignoreGlobalRules"`
}

// sslPolicyConfig is the subset of sslconfigs.SSLPolicy we read.
type sslPolicyConfig struct {
	ID       int64 `json:"id"`
	CertRefs []struct {
		IsOn   bool  `json:"isOn"`
		CertID int64 `json:"certId"`
	} `json:"certRefs"`
	MinVersion   string `json:"minVersion"`
	HTTP2Enabled bool   `json:"http2Enabled"`
	HSTS         *struct {
		IsOn bool `json:"isOn"`
	} `json:"hsts"`
}

// sslCertConfig is sslconfigs.SSLCertConfig without the PEM data.
type sslCertConfig struct {
	ID          int64    `json:"id"`
	IsOn        bool     `json:"isOn"`
	Name        string   `json:"name"`
	IsCA        bool     `json:"isCA"`
	IsACME      bool     `json:"isACME"`
	TimeBeginAt int64    `json:"timeBeginAt"`
	TimeEndAt   int64    `json:"timeEndAt"`
	DNSNames    []string `json:"dnsNames"`
	CommonNames []string `json:"commonNames"`
}

// rawObject is a JSON object kept as raw values (read-modify-write).
type rawObject map[string]json.RawMessage

func parseRawObject(data []byte) rawObject {
	o := rawObject{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &o)
	}
	if o == nil {
		o = rawObject{}
	}
	return o
}

func (o rawObject) set(key string, v any) {
	data, _ := json.Marshal(v)
	o[key] = data
}

func (o rawObject) get(key string, v any) bool {
	raw, ok := o[key]
	if !ok || len(raw) == 0 || string(raw) == "null" {
		return false
	}
	return json.Unmarshal(raw, v) == nil
}

func (o rawObject) bytes() []byte {
	data, _ := json.Marshal(o)
	return data
}

func tlsVersionToEdge(v string) string {
	switch v {
	case "1.0", "1.1", "1.2", "1.3":
		return "TLS " + v
	}
	return "TLS 1.2"
}

func tlsVersionFromEdge(v string) string {
	v = strings.TrimSpace(strings.TrimPrefix(v, "TLS"))
	switch v {
	case "1.0", "1.1", "1.2", "1.3":
		return v
	}
	return "1.0" // EdgeAPI default when unset
}

func portOf(pr string, def int) int {
	pr = strings.TrimSpace(pr)
	if i := strings.Index(pr, "-"); i > 0 {
		pr = pr[:i]
	}
	n, err := strconv.Atoi(pr)
	if err != nil || n <= 0 {
		return def
	}
	return n
}
