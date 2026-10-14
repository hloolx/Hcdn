package pathsafety

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestIsSafeFilename(t *testing.T) {
	var cases = []struct {
		in   string
		want bool
	}{
		{"edge-node-linux-amd64.zip", true},
		{"a", true},
		{"a.b_c-D9", true},
		{"", false},
		{"..", false},
		{".", false},
		{"../etc/passwd", false},
		{"a/b", false},
		{`a\b`, false},
		{"/etc/passwd", false},
		{"with space.zip", false},
		{"with;semicolon", false},
		{"..hidden-but-not-traversal", true}, // not exactly "..", allowed by the pattern
	}
	for _, c := range cases {
		if got := IsSafeFilename(c.in); got != c.want {
			t.Errorf("IsSafeFilename(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestSafeJoin_Valid(t *testing.T) {
	var base = filepath.Join(string(filepath.Separator)+"tmp", "deploy")

	var cases = []struct {
		rel  string
		want string
	}{
		{"file.zip", filepath.Join(base, "file.zip")},
		{"sub/file.zip", filepath.Join(base, "sub", "file.zip")},
		{"./file.zip", filepath.Join(base, "file.zip")},
		{"sub/../file.zip", filepath.Join(base, "file.zip")}, // net result stays inside base: allowed
	}
	for _, c := range cases {
		got, err := SafeJoin(base, c.rel)
		if err != nil {
			t.Errorf("SafeJoin(%q, %q) unexpected error: %v", base, c.rel, err)
			continue
		}
		if got != c.want {
			t.Errorf("SafeJoin(%q, %q) = %q, want %q", base, c.rel, got, c.want)
		}
	}
}

func TestSafeJoin_Rejects(t *testing.T) {
	var base = filepath.Join(string(filepath.Separator)+"tmp", "deploy")

	var badRels = []string{
		"",
		"../escape.txt",
		"../../escape.txt",
		"sub/../../escape.txt",
		"sub/../../../escape.txt",
	}
	for _, rel := range badRels {
		if _, err := SafeJoin(base, rel); err == nil {
			t.Errorf("SafeJoin(%q, %q) = nil error, want an error (escapes base dir)", base, rel)
		}
	}

	// Absolute paths must always be rejected, regardless of where they point.
	// Built per-OS so the case is a genuine absolute path under
	// filepath.IsAbs on whichever platform the test runs on (a bare
	// "\foo\bar" is not an absolute path on Windows without a volume name).
	var absRels []string
	if runtime.GOOS == "windows" {
		absRels = []string{`C:\Windows\System32\config\sam`, `D:\inside-but-absolute.txt`}
	} else {
		absRels = []string{"/etc/passwd", filepath.Join(base, "inside-but-absolute.txt")}
	}
	for _, rel := range absRels {
		if !filepath.IsAbs(rel) {
			t.Fatalf("test setup bug: %q is not absolute on %s", rel, runtime.GOOS)
		}
		if _, err := SafeJoin(base, rel); err == nil {
			t.Errorf("SafeJoin(%q, %q) = nil error, want an error (absolute path)", base, rel)
		}
	}
}

func TestSafeJoin_BaseItself(t *testing.T) {
	var base = filepath.Join(string(filepath.Separator)+"tmp", "deploy")
	got, err := SafeJoin(base, ".")
	if err != nil {
		t.Fatalf("SafeJoin(%q, \".\") unexpected error: %v", base, err)
	}
	if got != base {
		t.Errorf("SafeJoin(%q, \".\") = %q, want %q", base, got, base)
	}
}
