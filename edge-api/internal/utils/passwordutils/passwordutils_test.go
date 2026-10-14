package passwordutils

import (
	"testing"

	stringutil "github.com/iwind/TeaGo/utils/string"
)

func TestIsBcryptHash(t *testing.T) {
	hash, err := HashPassword("hello12345")
	if err != nil {
		t.Fatal(err)
	}

	var cases = []struct {
		in   string
		want bool
	}{
		{hash, true},
		{"$2a$10$abcdefghijklmnopqrstuv", true},
		{"$2b$12$abcdefghijklmnopqrstuv", true},
		{"$2y$10$abcdefghijklmnopqrstuv", true},
		{stringutil.Md5("hello12345"), false},
		{"", false},
		{"not-a-hash", false},
	}
	for _, c := range cases {
		if got := IsBcryptHash(c.in); got != c.want {
			t.Errorf("IsBcryptHash(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestIsLegacyMD5Hex(t *testing.T) {
	var cases = []struct {
		in   string
		want bool
	}{
		{stringutil.Md5("hello12345"), true},
		{"0123456789abcdef0123456789abcdef", true},
		{"0123456789ABCDEF0123456789abcdef", false}, // uppercase: this project never produces this
		{"", false},
		{"short", false},
		{"0123456789abcdef0123456789abcdeff", false}, // 33 chars
	}
	for _, c := range cases {
		if got := IsLegacyMD5Hex(c.in); got != c.want {
			t.Errorf("IsLegacyMD5Hex(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

// TestVerify_Bcrypt covers the "already migrated" row: plain bcrypt compare,
// no upgrade, right or wrong password.
func TestVerify_Bcrypt(t *testing.T) {
	const plaintext = "correct horse battery staple"
	hash, err := HashPassword(plaintext)
	if err != nil {
		t.Fatal(err)
	}

	ok, upgrade := Verify(plaintext, hash)
	if !ok || upgrade {
		t.Errorf("Verify(correct, bcrypt) = (%v, %v), want (true, false)", ok, upgrade)
	}

	ok, upgrade = Verify("wrong password", hash)
	if ok || upgrade {
		t.Errorf("Verify(wrong, bcrypt) = (%v, %v), want (false, false)", ok, upgrade)
	}

	// A client that sends the legacy MD5 digest instead of the plaintext
	// must NOT be accepted once the row is bcrypt (we have no way to check
	// it without the real plaintext).
	ok, upgrade = Verify(stringutil.Md5(plaintext), hash)
	if ok || upgrade {
		t.Errorf("Verify(md5-of-correct, bcrypt) = (%v, %v), want (false, false)", ok, upgrade)
	}
}

// TestVerify_LegacyMD5_PlaintextMatch covers a pre-FIX-15 row (bare MD5
// digest) being verified with the real plaintext: should succeed and ask
// for an upgrade.
func TestVerify_LegacyMD5_PlaintextMatch(t *testing.T) {
	const plaintext = "an0ldPassw0rd"
	var stored = stringutil.Md5(plaintext)

	ok, upgrade := Verify(plaintext, stored)
	if !ok || !upgrade {
		t.Errorf("Verify(plaintext, legacyMd5) = (%v, %v), want (true, true)", ok, upgrade)
	}

	ok, upgrade = Verify("wrong", stored)
	if ok || upgrade {
		t.Errorf("Verify(wrong, legacyMd5) = (%v, %v), want (false, false)", ok, upgrade)
	}
}

// TestVerify_LegacyMD5_OldUIDigest covers the old admin UI, which MD5-hashes
// the password client-side and sends the digest itself: must still work
// against a legacy row, but must never be upgraded (no plaintext available).
func TestVerify_LegacyMD5_OldUIDigest(t *testing.T) {
	const plaintext = "an0ldPassw0rd"
	var stored = stringutil.Md5(plaintext)
	var submittedDigest = stringutil.Md5(plaintext) // what the old UI sends

	ok, upgrade := Verify(submittedDigest, stored)
	if !ok {
		t.Fatalf("Verify(old-ui-digest, legacyMd5) ok = %v, want true", ok)
	}
	if upgrade {
		t.Errorf("Verify(old-ui-digest, legacyMd5) must never request an upgrade (no plaintext available)")
	}

	// A digest that does not match the stored legacy value must fail.
	ok, _ = Verify(stringutil.Md5("something-else"), stored)
	if ok {
		t.Errorf("Verify(unrelated-digest, legacyMd5) = true, want false")
	}
}

func TestVerify_EmptyInputs(t *testing.T) {
	if ok, upgrade := Verify("", "whatever"); ok || upgrade {
		t.Errorf("Verify(empty submitted, _) = (%v, %v), want (false, false)", ok, upgrade)
	}
	if ok, upgrade := Verify("whatever", ""); ok || upgrade {
		t.Errorf("Verify(_, empty stored) = (%v, %v), want (false, false)", ok, upgrade)
	}
}
