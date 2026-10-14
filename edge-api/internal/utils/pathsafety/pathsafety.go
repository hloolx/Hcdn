// Package pathsafety provides small, pure helpers to guard against path
// traversal when a caller-supplied name is turned into a filesystem path:
// uploaded file names (FIX-44) and zip archive entry names (FIX-02/43),
// a.k.a. "zip slip".
package pathsafety

import (
	"errors"
	"path/filepath"
	"regexp"
	"strings"
)

// safeFilenamePattern matches a single, unsuspicious path component: ASCII
// letters, digits, dot, underscore, hyphen. No separators, so it can never
// contain '..' as a traversal segment (a lone ".", or sequences of dots,
// cannot address a parent directory by itself).
var safeFilenamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// IsSafeFilename reports whether name is a single path component consisting
// only of [A-Za-z0-9._-] characters, as required for e.g. an uploaded
// deploy file's name. "." and ".." are rejected explicitly: the character
// class alone would otherwise accept them (both consist only of dots).
func IsSafeFilename(name string) bool {
	if name == "." || name == ".." {
		return false
	}
	return len(name) > 0 && safeFilenamePattern.MatchString(name)
}

// SafeJoin joins baseDir with the caller/archive-supplied relative path rel
// and guarantees the result is baseDir itself or a descendant of it.
//
// rel must not be an absolute path. After joining (which also cleans the
// result, resolving any "." / ".." segments), the path must still be inside
// baseDir - this is what catches "zip slip" style entries such as
// "../../etc/passwd" or deeply nested equivalents.
func SafeJoin(baseDir string, rel string) (string, error) {
	if len(rel) == 0 {
		return "", errors.New("pathsafety: entry path must not be empty")
	}
	if filepath.IsAbs(rel) {
		return "", errors.New("pathsafety: entry path must not be absolute: " + rel)
	}

	var cleanBase = filepath.Clean(baseDir)
	var joined = filepath.Join(cleanBase, rel)

	if joined != cleanBase && !strings.HasPrefix(joined, cleanBase+string(filepath.Separator)) {
		return "", errors.New("pathsafety: entry path escapes target directory: " + rel)
	}

	return joined, nil
}
