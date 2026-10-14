package totp

import (
	"encoding/base32"
	"testing"
	"time"
)

// RFC 6238 Appendix B (SHA-1, 8 digits) truncated to 6 digits.
func TestRFC6238Vectors(t *testing.T) {
	key := []byte("12345678901234567890")
	cases := map[int64]string{
		59:          "287082",
		1111111109:  "081804",
		1111111111:  "050471",
		1234567890:  "005924",
		2000000000:  "279037",
		20000000000: "353130",
	}
	for ts, want := range cases {
		if got := At(key, time.Unix(ts, 0)); got != want {
			t.Errorf("t=%d got %s want %s", ts, got, want)
		}
	}
}

func TestVerifyWindow(t *testing.T) {
	key := []byte("12345678901234567890")
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(key)
	now := time.Unix(1111111111, 0)
	code := At(key, now)
	if !Verify(secret, code, now) {
		t.Fatal("current code rejected")
	}
	if !Verify(secret, code, now.Add(30*time.Second)) || !Verify(secret, code, now.Add(-30*time.Second)) {
		t.Fatal("±1 step not accepted")
	}
	if Verify(secret, code, now.Add(90*time.Second)) {
		t.Fatal("code accepted 3 steps later")
	}
	if Verify(secret, "12345", now) || Verify(secret, "abcdef", now) || Verify("", code, now) {
		t.Fatal("malformed input accepted")
	}
	// Lower-case secret with spaces (as shown in authenticator apps).
	if !Verify("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", code, now) {
		t.Fatal("formatted secret rejected")
	}
}
