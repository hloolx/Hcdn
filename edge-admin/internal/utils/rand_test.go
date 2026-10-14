package utils

import (
	"regexp"
	"testing"
)

func TestRandomString(t *testing.T) {
	if RandomString(0) != "" {
		t.Fatal("expected empty string for n<=0")
	}
	if RandomString(-1) != "" {
		t.Fatal("expected empty string for n<=0")
	}

	var reg = regexp.MustCompile(`^[0-9a-zA-Z]+$`)
	for _, n := range []int{1, 8, 16, 32, 64} {
		var s = RandomString(n)
		if len(s) != n {
			t.Fatalf("expected length %d, got %d ('%s')", n, len(s), s)
		}
		if !reg.MatchString(s) {
			t.Fatalf("unexpected charset in '%s'", s)
		}
	}

	// 两次生成结果不应该相同（可以接受理论上极小概率的碰撞，但不应该是确定性的）
	if RandomString(32) == RandomString(32) {
		t.Fatal("expected two independently generated strings to differ")
	}
}

func TestRandomHexString(t *testing.T) {
	if RandomHexString(0) != "" {
		t.Fatal("expected empty string for n<=0")
	}

	var reg = regexp.MustCompile(`^[0-9a-f]+$`)
	for _, n := range []int{1, 2, 6, 8, 32} {
		var s = RandomHexString(n)
		if len(s) != n {
			t.Fatalf("expected length %d, got %d ('%s')", n, len(s), s)
		}
		if !reg.MatchString(s) {
			t.Fatalf("unexpected charset in '%s'", s)
		}
	}

	if RandomHexString(32) == RandomHexString(32) {
		t.Fatal("expected two independently generated strings to differ")
	}
}
