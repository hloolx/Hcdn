package securerand

import (
	"strings"
	"testing"
)

func TestRandString_LengthAndAlphabet(t *testing.T) {
	for _, n := range []int{0, 1, 16, 32, 128} {
		var s = RandString(n)
		if len(s) != n {
			t.Fatalf("RandString(%d) length = %d, want %d", n, len(s), n)
		}
		for _, c := range s {
			if !strings.ContainsRune(letterChars, c) {
				t.Fatalf("RandString(%d) produced out-of-alphabet char %q", n, c)
			}
		}
	}
}

func TestRandHexString_LengthAndAlphabet(t *testing.T) {
	for _, n := range []int{0, 1, 6, 10, 32} {
		var s = RandHexString(n)
		if len(s) != n {
			t.Fatalf("RandHexString(%d) length = %d, want %d", n, len(s), n)
		}
		for _, c := range s {
			if !strings.ContainsRune(hexChars, c) {
				t.Fatalf("RandHexString(%d) produced out-of-alphabet char %q", n, c)
			}
		}
	}
}

func TestRandString_NegativeOrZero(t *testing.T) {
	if s := RandString(0); s != "" {
		t.Errorf("RandString(0) = %q, want empty", s)
	}
	if s := RandString(-1); s != "" {
		t.Errorf("RandString(-1) = %q, want empty", s)
	}
}

// TestRandString_NotConstant is a light sanity check that successive calls
// are not returning the same value (i.e. we are actually drawing fresh
// randomness rather than e.g. a fixed/zeroed buffer).
func TestRandString_NotConstant(t *testing.T) {
	var a = RandString(32)
	var b = RandString(32)
	if a == b {
		t.Errorf("two successive RandString(32) calls returned the same value: %q", a)
	}
}
