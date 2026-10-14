package encrypt

import "testing"

// TestDecodeLegacyDBNodePassword fabricates a ciphertext the same way the
// retired MagicKeyEncode used to (directly via the still-generic AES-256-CFB
// primitive, not via any production "encode" helper - there no longer is
// one), then checks DecodeLegacyDBNodePassword still reads historical data
// correctly now that sealing (internal/utils/sealed) handles all new writes.
func TestDecodeLegacyDBNodePassword(t *testing.T) {
	method, err := NewMethodInstance("aes-256-cfb", legacyDBNodePasswordKey, legacyDBNodePasswordKey[:16])
	if err != nil {
		t.Fatal(err)
	}

	const plaintext = "Hello,World"
	ciphertext, err := method.Encrypt([]byte(plaintext))
	if err != nil {
		t.Fatal(err)
	}

	decoded, err := DecodeLegacyDBNodePassword(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != plaintext {
		t.Fatalf("expected %q, got %q", plaintext, string(decoded))
	}
}
