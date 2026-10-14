package models

import (
	"github.com/TeaOSLab/EdgeAPI/internal/utils/sealed"
	_ "github.com/go-sql-driver/mysql"
	"strings"
	"testing"
)

func TestSealGrantSecret_RoundTrip(t *testing.T) {
	for _, plain := range []string{
		"",
		"a-normal-ssh-password",
		"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==\n-----END OPENSSH PRIVATE KEY-----",
	} {
		sealedValue, err := sealGrantSecret(plain, "password", nodeGrantPasswordColumnMaxLen)
		if plain == "" {
			if err != nil || sealedValue != "" {
				t.Fatalf("expected empty passthrough, got %q, %v", sealedValue, err)
			}
			continue
		}
		if len(plain) > nodeGrantPasswordColumnMaxLen {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if !sealed.IsSealed(sealedValue) {
			t.Fatalf("expected a sealed value, got %q", sealedValue)
		}
		if openGrantSecret(sealedValue) != plain {
			t.Fatalf("round trip mismatch for %q", plain)
		}
	}
}

// TestSealGrantSecret_RejectsColumnOverflow guards against silently
// truncating (or corrupting) a secret that happens to seal to something
// longer than its destination varchar column. edgeNodeGrants.privateKey is
// varchar(4096): sealing adds ~28 bytes of AES-256-GCM overhead plus
// base64/prefix expansion on top of the plaintext, so a large key (e.g. an
// RSA-4096 PEM, ~3.2KB) that fits in the column as plaintext can overflow it
// once sealed.
func TestSealGrantSecret_RejectsColumnOverflow(t *testing.T) {
	// Build a plaintext whose sealed form is just barely over the limit of a
	// small test column, without needing to generate a real RSA key.
	const maxLen = 100
	var big = strings.Repeat("A", 200)

	_, err := sealGrantSecret(big, "privateKey", maxLen)
	if err == nil {
		t.Fatal("expected an error instead of a truncated/oversized value")
	}
	t.Log("got expected error:", err)
}

func TestSealGrantSecret_AllowsValueWithinColumnLimit(t *testing.T) {
	sealedValue, err := sealGrantSecret("short-secret", "password", nodeGrantPasswordColumnMaxLen)
	if err != nil {
		t.Fatal(err)
	}
	if len(sealedValue) > nodeGrantPasswordColumnMaxLen {
		t.Fatalf("sealed value (%d chars) should have fit the column limit (%d)", len(sealedValue), nodeGrantPasswordColumnMaxLen)
	}
}

func TestOpenGrantSecret_LegacyPlaintextPassthrough(t *testing.T) {
	const legacy = "plain-ssh-password"
	if openGrantSecret(legacy) != legacy {
		t.Fatal("expected legacy plaintext to pass through unchanged")
	}
}
