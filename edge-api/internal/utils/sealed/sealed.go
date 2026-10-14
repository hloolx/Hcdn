// Package sealed provides at-rest encryption for secrets EdgeAPI stores in
// its database: SSL certificate private keys, SSH installation credentials
// and database node passwords. Values are sealed with AES-256-GCM using a
// 32-byte key generated once with crypto/rand on first start and kept only
// in a local file under the API node's config directory (never written to
// the database, never logged). Losing that file makes every sealed value
// unrecoverable, so it must be backed up together with the database.
//
// Sealed output is tagged with Prefix so callers can tell sealed values
// apart from legacy plaintext written before this package existed: Open on a
// value that does not carry Prefix returns it unchanged, so reads keep
// working while existing data is migrated to sealed storage.
package sealed

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/iwind/TeaGo/Tea"
)

// Prefix marks a value as produced by Seal. Values without it are treated by
// Open as legacy plaintext.
const Prefix = "$hcdn1$"

// keySize is the AES-256 key size in bytes.
const keySize = 32

const keyFileName = "secret.key"

var (
	keyOnce  sync.Once
	keyBytes []byte
	keyErr   error
)

// Seal encrypts plain with the instance secret key and returns a
// Prefix-tagged, base64-encoded string that is safe to store in a database
// text or blob column.
func Seal(plain []byte) (string, error) {
	key, err := currentKey()
	if err != nil {
		return "", err
	}
	return sealWithKey(key, plain)
}

// Open reverses Seal. If value does not carry Prefix, it is assumed to be
// legacy plaintext written before this package existed and is returned
// unchanged (no error, no key access), so existing reads keep working until
// a migration seals it.
func Open(value string) ([]byte, error) {
	if !IsSealed(value) {
		return []byte(value), nil
	}
	key, err := currentKey()
	if err != nil {
		return nil, err
	}
	return openWithKey(key, value)
}

// IsSealed reports whether value was produced by Seal, as opposed to being
// legacy plaintext.
func IsSealed(value string) bool {
	return strings.HasPrefix(value, Prefix)
}

// KeyPath returns the file path the instance secret key is stored at. It is
// meant for startup logging/diagnostics only; it never returns the key
// itself.
func KeyPath() string {
	return defaultKeyPath()
}

func currentKey() ([]byte, error) {
	keyOnce.Do(func() {
		keyBytes, keyErr = loadOrCreateKeyAt(defaultKeyPath())
	})
	return keyBytes, keyErr
}

func defaultKeyPath() string {
	return Tea.ConfigFile(keyFileName)
}

// loadOrCreateKeyAt reads the instance secret key from path, generating and
// persisting a new random one (file mode 0600, parent directory mode 0700)
// if no file exists yet. It never overwrites an existing file - even one
// whose content looks wrong - since doing so could silently make previously
// sealed data unrecoverable; callers get an error in that case instead.
func loadOrCreateKeyAt(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		key, decodeErr := decodeKeyFile(data)
		if decodeErr != nil {
			return nil, fmt.Errorf("sealed: secret key file %s is unreadable: %w", path, decodeErr)
		}
		if len(key) != keySize {
			return nil, fmt.Errorf("sealed: secret key file %s does not contain a %d-byte key", path, keySize)
		}
		return key, nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("sealed: reading secret key file %s: %w", path, err)
	}

	key := make([]byte, keySize)
	if _, randErr := io.ReadFull(rand.Reader, key); randErr != nil {
		return nil, fmt.Errorf("sealed: generating secret key: %w", randErr)
	}

	if mkErr := os.MkdirAll(filepath.Dir(path), 0700); mkErr != nil {
		return nil, fmt.Errorf("sealed: creating config directory for %s: %w", path, mkErr)
	}
	if writeErr := os.WriteFile(path, encodeKeyFile(key), 0600); writeErr != nil {
		return nil, fmt.Errorf("sealed: writing secret key file %s: %w", path, writeErr)
	}
	return key, nil
}

func encodeKeyFile(key []byte) []byte {
	return []byte(base64.StdEncoding.EncodeToString(key) + "\n")
}

func decodeKeyFile(data []byte) ([]byte, error) {
	return base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
}

func sealWithKey(key []byte, plain []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("sealed: generating nonce: %w", err)
	}
	ciphertext := gcm.Seal(nonce, nonce, plain, nil)
	return Prefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

func openWithKey(key []byte, value string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(value[len(Prefix):])
	if err != nil {
		return nil, fmt.Errorf("sealed: invalid encoding: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, errors.New("sealed: ciphertext too short")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("sealed: authentication failed (tampered data or wrong key): %w", err)
	}
	return plain, nil
}
