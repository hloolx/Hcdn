package sealed

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testKey() []byte {
	key := make([]byte, keySize)
	for i := range key {
		key[i] = byte(i)
	}
	return key
}

func TestSealOpenRoundTrip(t *testing.T) {
	key := testKey()
	plain := []byte("hello sealed world")

	sealedValue, err := sealWithKey(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(sealedValue, Prefix) {
		t.Fatalf("sealed value missing prefix: %q", sealedValue)
	}

	opened, err := openWithKey(key, sealedValue)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(opened, plain) {
		t.Fatalf("round trip mismatch: got %q want %q", opened, plain)
	}
}

func TestSealEmptyPlaintextRoundTrips(t *testing.T) {
	key := testKey()
	sealedValue, err := sealWithKey(key, []byte(""))
	if err != nil {
		t.Fatal(err)
	}
	opened, err := openWithKey(key, sealedValue)
	if err != nil {
		t.Fatal(err)
	}
	if len(opened) != 0 {
		t.Fatalf("expected empty plaintext, got %q", opened)
	}
}

func TestSealProducesDistinctCiphertexts(t *testing.T) {
	key := testKey()
	a, err := sealWithKey(key, []byte("same plaintext"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := sealWithKey(key, []byte("same plaintext"))
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("expected distinct ciphertexts for repeated seals of the same plaintext (random nonce)")
	}
}

func TestOpenDetectsTampering(t *testing.T) {
	key := testKey()
	sealedValue, err := sealWithKey(key, []byte("do not modify me"))
	if err != nil {
		t.Fatal(err)
	}

	payload := sealedValue[len(Prefix):]
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)-1] ^= 0xFF
	tampered := Prefix + base64.StdEncoding.EncodeToString(raw)

	if _, err := openWithKey(key, tampered); err == nil {
		t.Fatal("expected tampering to be detected")
	}
}

func TestOpenWithWrongKeyFails(t *testing.T) {
	key1 := testKey()
	key2 := bytes.Repeat([]byte{0x42}, keySize)

	sealedValue, err := sealWithKey(key1, []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := openWithKey(key2, sealedValue); err == nil {
		t.Fatal("expected an error when opening with the wrong key")
	}
}

func TestOpenRejectsTruncatedCiphertext(t *testing.T) {
	key := testKey()
	if _, err := openWithKey(key, Prefix+base64.StdEncoding.EncodeToString([]byte("short"))); err == nil {
		t.Fatal("expected an error for ciphertext shorter than the nonce")
	}
}

func TestOpenLegacyPlaintextPassthrough(t *testing.T) {
	// Open must hand back any value without the sealed prefix unchanged (and
	// without touching the instance key), so pre-existing plaintext rows
	// keep working until a migration seals them.
	const legacy = "-----BEGIN RSA PRIVATE KEY-----\nMIIC...\n-----END RSA PRIVATE KEY-----"
	got, err := Open(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != legacy {
		t.Fatalf("expected passthrough, got %q", got)
	}
}

func TestOpenEmptyStringPassthrough(t *testing.T) {
	got, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty passthrough, got %q", got)
	}
}

func TestIsSealed(t *testing.T) {
	if IsSealed("plain-legacy-value") {
		t.Fatal("plain value should not be reported as sealed")
	}
	if IsSealed("") {
		t.Fatal("empty value should not be reported as sealed")
	}
	if !IsSealed(Prefix + "abc") {
		t.Fatal("prefixed value should be reported as sealed")
	}
}

func TestLoadOrCreateKeyAtGeneratesAndPersists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "secret.key")

	key1, err := loadOrCreateKeyAt(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(key1) != keySize {
		t.Fatalf("expected a %d-byte key, got %d", keySize, len(key1))
	}

	// A second call against the same path must load the persisted key back
	// rather than generating a new one - otherwise every restart would make
	// previously sealed data unrecoverable.
	key2, err := loadOrCreateKeyAt(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(key1, key2) {
		t.Fatal("expected loadOrCreateKeyAt to reuse the persisted key on a second call")
	}

	if runtime.GOOS != "windows" {
		stat, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if stat.Mode().Perm() != 0600 {
			t.Fatalf("expected key file mode 0600, got %v", stat.Mode().Perm())
		}
	}
}

func TestLoadOrCreateKeyAtRejectsCorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.key")
	if err := os.WriteFile(path, []byte("not a valid key"), 0600); err != nil {
		t.Fatal(err)
	}

	if _, err := loadOrCreateKeyAt(path); err == nil {
		t.Fatal("expected an error instead of silently regenerating over an existing malformed key file")
	}
}
