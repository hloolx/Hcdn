// Package rpcutils provides small, pure helpers for validating the RPC
// endpoints a node is configured (or later told by the control plane) to
// dial. Kept dependency-free (no cgo, no OS-specific build tags) so it can
// be unit tested without a Linux target.
package rpcutils

import (
	"fmt"
	"net"
	"net/url"
)

// ValidateEndpoint checks that endpoint ("scheme://host:port") is safe to
// dial as the node's control-plane (API) connection:
//   - only the "http" and "https" schemes are accepted;
//   - "http" (plaintext) is only accepted when the host is a loopback
//     address (127.0.0.0/8, ::1, or the literal hostname "localhost"); any
//     other host must use "https", so that the node's auth token -- and any
//     secrets the control plane sends back, such as TLS private keys in the
//     node config -- are never sent in plaintext over the network.
//
// It does not perform any I/O or DNS resolution: a non-loopback hostname is
// treated as non-loopback even if it happens to resolve to 127.0.0.1,
// since that mapping is attacker-controllable via DNS.
func ValidateEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("invalid endpoint '%s': %w", endpoint, err)
	}
	if len(u.Host) == 0 {
		return fmt.Errorf("invalid endpoint '%s': missing host", endpoint)
	}

	switch u.Scheme {
	case "https":
		return nil
	case "http":
		if IsLoopbackHost(u.Hostname()) {
			return nil
		}
		return fmt.Errorf("insecure endpoint '%s' rejected: plain 'http://' is only allowed for loopback addresses, use 'https://' instead", endpoint)
	default:
		return fmt.Errorf("invalid endpoint '%s': unsupported scheme '%s'", endpoint, u.Scheme)
	}
}

// IsLoopbackHost reports whether host -- a hostname or literal IP, without
// a port -- refers to the local loopback interface: 127.0.0.0/8, ::1, or
// the literal name "localhost". It does not resolve hostnames other than
// the literal "localhost".
func IsLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	var ip = net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// EndpointIsAllowed reports whether endpoint is present in allowedEndpoints, using an exact
// string match (endpoints are compared as written, e.g. "https://host:port").
//
// This is used to enforce that the control plane can only move a node's RPC connection to a
// host the node already knew about locally: server-supplied endpoints that aren't in this set
// must be ignored rather than adopted (see FIX-27). Matching is intentionally a plain string
// comparison, not a semantic/URL-aware one, so the allowlist is easy to reason about; operators
// must list endpoints exactly as the API node advertises them (scheme + host + port).
func EndpointIsAllowed(endpoint string, allowedEndpoints []string) bool {
	for _, allowed := range allowedEndpoints {
		if allowed == endpoint {
			return true
		}
	}
	return false
}
