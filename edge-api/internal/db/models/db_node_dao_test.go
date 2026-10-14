package models

import (
	"encoding/base64"
	"github.com/TeaOSLab/EdgeAPI/internal/encrypt"
	"github.com/TeaOSLab/EdgeAPI/internal/utils/sealed"
	_ "github.com/go-sql-driver/mysql"
	"strings"
	"testing"
)

func TestDBNodeDAO_EncodePassword(t *testing.T) {
	dao := NewDBNodeDAO()
	for _, password := range []string{
		"123456",
		"abcdefxyz",
		"123abc$*&^%",
		"$%#@!@(*))*&^&=]{|",
		"中文",
	} {
		encoded, err := dao.EncodePassword(password)
		if err != nil {
			t.Fatal(err)
		}
		if !sealed.IsSealed(encoded) {
			t.Fatalf("expected EncodePassword to seal the value, got %q", encoded)
		}
		decoded := dao.DecodePassword(encoded)
		if decoded != password {
			t.Fatal(decoded, password)
		}
	}
}

func TestDBNodeDAO_EncodePassword_AlreadyEncoded(t *testing.T) {
	dao := NewDBNodeDAO()
	password := DBNodePasswordEncodedPrefix + "123456"
	encoded, err := dao.EncodePassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if encoded != password {
		t.Fatal("expected a value already carrying the legacy prefix to pass through unchanged")
	}
	t.Log(encoded)
}

func TestDBNodeDAO_EncodePassword_AlreadySealed(t *testing.T) {
	dao := NewDBNodeDAO()
	sealedPassword, err := sealed.Seal([]byte("123456"))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := dao.EncodePassword(sealedPassword)
	if err != nil {
		t.Fatal(err)
	}
	if encoded != sealedPassword {
		t.Fatal("expected an already-sealed value to pass through unchanged instead of being wrapped again")
	}
}

func TestDBNodeDAO_DecodePassword_PlainPassthrough(t *testing.T) {
	dao := NewDBNodeDAO()
	password := "123456"
	decoded := dao.DecodePassword(password)
	if decoded != password {
		t.Fatal()
	}
	t.Log(decoded)
}

// TestDBNodeDAO_DecodePassword_Legacy fabricates a value the way the retired
// global-MagicKey DBNodeDAO.EncodePassword used to (via the still-generic
// AES-256-CFB primitive - production code no longer has an "encode" helper
// for the legacy key, only DecodeLegacyDBNodePassword) and checks that
// DecodePassword still recovers it, which is what lets
// MigrateLegacyPasswords re-seal pre-existing "EDGE_ENCODED:" rows.
func TestDBNodeDAO_DecodePassword_Legacy(t *testing.T) {
	const legacyKey = "f1c8eafb543f03023e97b7be864a4e9b"
	method, err := encrypt.NewMethodInstance("aes-256-cfb", legacyKey, legacyKey[:16])
	if err != nil {
		t.Fatal(err)
	}

	const plaintext = "legacy-db-password"
	ciphertext, err := method.Encrypt([]byte(plaintext))
	if err != nil {
		t.Fatal(err)
	}

	var legacyValue = DBNodePasswordEncodedPrefix + base64.StdEncoding.EncodeToString(ciphertext)

	dao := NewDBNodeDAO()
	decoded := dao.DecodePassword(legacyValue)
	if decoded != plaintext {
		t.Fatalf("expected %q, got %q", plaintext, decoded)
	}
}

// TestDBNodeDAO_EncodePassword_RejectsColumnOverflow guards against silently
// truncating (or corrupting) a password whose sealed form would no longer
// fit edgeDBNodes.password (varchar(255)): sealing adds ~28 bytes of
// AES-256-GCM overhead plus base64/prefix expansion on top of the plaintext.
func TestDBNodeDAO_EncodePassword_RejectsColumnOverflow(t *testing.T) {
	dao := NewDBNodeDAO()
	// A 200-byte plaintext password seals to well over dbNodePasswordColumnMaxLen.
	var tooLong = strings.Repeat("A", 200)
	_, err := dao.EncodePassword(tooLong)
	if err == nil {
		t.Fatal("expected an error instead of a truncated/oversized value")
	}
	t.Log("got expected error:", err)
}
