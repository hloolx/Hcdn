//go:build !plus

package rpcutils

import "testing"

// TestAllowedClaim exercises the full role x claim matrix (FIX-01). The only
// allowed mismatch is an 'admin' role claiming 'api'; everything else must
// require an exact match.
func TestAllowedClaim(t *testing.T) {
	var roles = []string{
		UserTypeAdmin,
		UserTypeUser,
		UserTypeNode,
		UserTypeCluster,
		UserTypeDNS,
		UserTypeReport,
		UserTypeLog,
		UserTypeAPI,
		UserTypeAuthority,
		UserTypeProvider,
		UserTypeStat,
	}

	for _, role := range roles {
		for _, claimed := range roles {
			var want = role == claimed || (role == UserTypeAdmin && claimed == UserTypeAPI)
			var got = allowedClaim(role, claimed)
			if got != want {
				t.Errorf("allowedClaim(%q, %q) = %v, want %v", role, claimed, got, want)
			}
		}
	}

	// Spot checks for the documented exception and its boundaries.
	if !allowedClaim(UserTypeAdmin, UserTypeAPI) {
		t.Error("an 'admin' role token must be allowed to claim type 'api'")
	}
	if allowedClaim(UserTypeAPI, UserTypeAdmin) {
		t.Error("the exception must not run the other way: 'api' role must not claim 'admin'")
	}
	if allowedClaim(UserTypeNode, UserTypeAdmin) {
		t.Error("a 'node' role token must never be allowed to claim 'admin'")
	}
	if allowedClaim(UserTypeUser, UserTypeAdmin) {
		t.Error("a 'user' role token must never be allowed to claim 'admin'")
	}
	if allowedClaim("", UserTypeAdmin) || allowedClaim(UserTypeAdmin, "") || allowedClaim("", "") {
		t.Error("an empty role or claim must never be allowed")
	}
}

// TestIsFreshTimestamp exercises the +/-300s replay window (FIX-04) as a pure
// function, including the inclusive boundary and the "missing" case.
func TestIsFreshTimestamp(t *testing.T) {
	const now = int64(1_700_000_000)

	var cases = []struct {
		name      string
		timestamp int64
		want      bool
	}{
		{"exact now", now, true},
		{"missing (zero)", 0, false},
		{"negative", -1, false},
		{"299s in the past", now - 299, true},
		{"300s in the past (boundary, inclusive)", now - 300, true},
		{"301s in the past", now - 301, false},
		{"299s in the future", now + 299, true},
		{"300s in the future (boundary, inclusive)", now + 300, true},
		{"301s in the future", now + 301, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got = IsFreshTimestamp(c.timestamp, now, MaxTokenClockSkewSeconds)
			if got != c.want {
				t.Errorf("IsFreshTimestamp(%d, %d, %d) = %v, want %v", c.timestamp, now, MaxTokenClockSkewSeconds, got, c.want)
			}
		})
	}
}
