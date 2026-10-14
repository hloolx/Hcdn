// Package httpx holds the HTTP plumbing shared by the customer and admin APIs:
// client IP extraction, rate limiting, CSRF, security headers, JSON helpers and
// static SPA hosting.
package httpx

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// IPResolver extracts the client IP. X-Forwarded-For is honoured only when the
// TCP peer is a trusted proxy; then the right-most address that is not itself a
// trusted proxy wins (i.e. the left-most untrusted hop seen from our side).
type IPResolver struct {
	Trusted []netip.Prefix
}

func (r *IPResolver) trusted(a netip.Addr) bool {
	for _, p := range r.Trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// PeerTrusted reports whether the TCP peer is a trusted proxy.
func (r *IPResolver) PeerTrusted(req *http.Request) bool {
	peer, ok := peerAddr(req)
	return ok && r.trusted(peer)
}

func peerAddr(req *http.Request) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		host = req.RemoteAddr
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap().WithZone(""), true
}

// ClientIP returns the client address.
func (r *IPResolver) ClientIP(req *http.Request) netip.Addr {
	peer, ok := peerAddr(req)
	if !ok {
		return netip.IPv4Unspecified()
	}
	if !r.trusted(peer) {
		return peer
	}
	var hops []string
	for _, h := range req.Header.Values("X-Forwarded-For") {
		for _, part := range strings.Split(h, ",") {
			if part = strings.TrimSpace(part); part != "" {
				hops = append(hops, part)
			}
		}
	}
	client := peer
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(stripPort(hops[i]))
		if err != nil {
			// Garbage in the chain: stop at the last address we could trust.
			break
		}
		a = a.Unmap().WithZone("")
		client = a
		if !r.trusted(a) {
			break
		}
	}
	return client
}

// IsTLS reports whether the original request used TLS (directly or via a trusted proxy).
func (r *IPResolver) IsTLS(req *http.Request) bool {
	if req.TLS != nil {
		return true
	}
	if r.PeerTrusted(req) {
		return strings.EqualFold(strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")), "https")
	}
	return false
}

func stripPort(s string) string {
	if strings.HasPrefix(s, "[") {
		if i := strings.Index(s, "]"); i > 0 {
			return s[1:i]
		}
	}
	if strings.Count(s, ":") == 1 {
		if h, _, err := net.SplitHostPort(s); err == nil {
			return h
		}
	}
	return s
}

// HostOnly lowercases the Host header and strips the port.
func HostOnly(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	if h, _, err := net.SplitHostPort(host); err == nil {
		return strings.Trim(h, "[]")
	}
	return strings.Trim(host, "[]")
}
