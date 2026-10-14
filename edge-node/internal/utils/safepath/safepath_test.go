package safepath_test

import (
	"github.com/TeaOSLab/EdgeNode/internal/utils/safepath"
	"testing"
)

func TestContains_PlainTraversal(t *testing.T) {
	// classic "../" escape, Unix-style separators
	if safepath.Contains("/var/www/html", "/var/www/html/../../etc/passwd") {
		t.Fatal("expected traversal outside of root to be rejected")
	}
}

func TestContains_DecodedTraversal(t *testing.T) {
	// simulates a request path that already went through URL-decoding
	// upstream (e.g. "%2e%2e%2f%2e%2e%2f" -> "../../") before being joined
	// onto the root; the helper itself never decodes anything.
	var root = "/var/www/html"
	var candidate = root + "/" + "../../../etc/shadow"
	if safepath.Contains(root, candidate) {
		t.Fatal("expected decoded '../' traversal to be rejected")
	}
}

func TestContains_StaysWithinRoot(t *testing.T) {
	var root = "/var/www/html"
	var cases = []string{
		root,
		root + "/",
		root + "/index.html",
		root + "/a/../b", // cleans to root + "/b", still inside
		root + "/a/./b",
		root + "/sub/dir/file.txt",
	}
	for _, candidate := range cases {
		if !safepath.Contains(root, candidate) {
			t.Fatalf("expected %q to be contained in %q", candidate, root)
		}
	}
}

func TestContains_AbsoluteEscape(t *testing.T) {
	if safepath.Contains("/var/www/html", "/etc/passwd") {
		t.Fatal("expected an unrelated absolute path to be rejected")
	}
}

func TestContains_SiblingPrefixConfusion(t *testing.T) {
	// "/var/www/html-other" must not be considered contained in
	// "/var/www/html" just because it shares a string prefix.
	if safepath.Contains("/var/www/html", "/var/www/html-other/secret.txt") {
		t.Fatal("expected sibling directory with shared prefix to be rejected")
	}
}

func TestContains_WindowsSeparators(t *testing.T) {
	var root = `C:\site\www`
	if !safepath.Contains(root, `C:\site\www\sub\file.txt`) {
		t.Fatal("expected backslash-separated path within root to be contained")
	}
	if safepath.Contains(root, `C:\site\www\..\..\Windows\System32\config\sam`) {
		t.Fatal("expected backslash-separated '..' traversal to be rejected")
	}
}

func TestContains_MixedSeparators(t *testing.T) {
	// a root given with Unix separators, escaped using backslashes -- must
	// still be caught, since on some platforms/components backslash is also
	// treated as a separator.
	if safepath.Contains("/var/www/html", `/var/www/html\..\..\etc\passwd`) {
		t.Fatal("expected mixed-separator traversal to be rejected")
	}
}

func TestContains_EmptyOrDotRoot(t *testing.T) {
	if safepath.Contains("", "/anything") {
		t.Fatal("expected empty root to never contain anything")
	}
	if safepath.Contains(".", "foo") {
		t.Fatal("expected '.' root to never contain anything")
	}
}
