// Package safepath provides small, side-effect-free helpers for keeping a
// user- or server-controlled file path confined to an expected root
// directory (e.g. a site's static file root, a WAF block page, a firewall
// action script). It performs no I/O and never resolves symlinks: callers
// are expected to build the candidate path themselves (by joining untrusted
// input onto a root directory) and then call Contains *before* doing any
// filesystem operation (stat/open/exec) with that path.
package safepath

import (
	"path"
	"strings"
)

// Contains reports whether candidate is root itself, or a descendant of
// root, once both have been lexically cleaned.
//
// The check is purely textual. Both inputs are normalized with path.Clean
// (which collapses "." and ".." segments), and backslashes are treated as
// path separators too -- this keeps the result identical no matter which OS
// the code is built for (path.Clean, unlike filepath.Clean, does not change
// behavior per-GOOS), so the exact same logic that runs in production
// (always Linux, for this project) can be exercised by unit tests on any
// host OS.
//
// This is the standard defense against "../" traversal and
// path-separator-confusion attacks: it does not matter whether candidate
// was built via string concatenation, filepath.Join, or came from a
// URL-decoded request path -- as long as it is checked here before use.
func Contains(root string, candidate string) bool {
	var cleanRoot = path.Clean(toSlash(root))
	var cleanCandidate = path.Clean(toSlash(candidate))

	// An empty or "." root would make everything "contained" below, which
	// is never what a caller wants from a root-confinement check.
	if cleanRoot == "" || cleanRoot == "." {
		return false
	}

	if cleanCandidate == cleanRoot {
		return true
	}
	return strings.HasPrefix(cleanCandidate, cleanRoot+"/")
}

func toSlash(s string) string {
	return strings.ReplaceAll(s, "\\", "/")
}
