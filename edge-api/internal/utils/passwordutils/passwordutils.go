// Package passwordutils provides the password hashing/verification helpers
// used for admin and user login (FIX-15).
//
// Passwords are stored as bcrypt hashes (golang.org/x/crypto/bcrypt), which
// are salted and deliberately slow to compute, unlike this project's old
// storage format of a bare unsalted MD5 hex digest.
//
// For backwards compatibility with rows written before this change (and to
// avoid a hard schema migration), a stored value that is not a bcrypt hash
// is treated as the legacy MD5 digest. A successful legacy verification
// transparently upgrades the row to bcrypt - see Verify for the exact rules,
// including the narrow exception kept for clients that still MD5-hash the
// password themselves before sending it.
package passwordutils

import (
	"regexp"
	"strings"

	stringutil "github.com/iwind/TeaGo/utils/string"
	"golang.org/x/crypto/bcrypt"
)

// bcryptCost is the work factor used when hashing new passwords.
const bcryptCost = bcrypt.DefaultCost

// legacyMD5Pattern matches this project's old password storage format: a
// bare, unsalted, lowercase-hex MD5 digest (32 hex characters).
var legacyMD5Pattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// HashPassword returns a bcrypt hash of plaintext, suitable for storage in a
// 'password' column.
func HashPassword(plaintext string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// IsBcryptHash reports whether 'stored' has the shape of a bcrypt hash, as
// opposed to this project's legacy unsalted MD5 hex digest.
func IsBcryptHash(stored string) bool {
	return strings.HasPrefix(stored, "$2a$") ||
		strings.HasPrefix(stored, "$2b$") ||
		strings.HasPrefix(stored, "$2y$")
}

// IsLegacyMD5Hex reports whether s has the shape of a bare 32-hex-character
// MD5 digest, this project's pre-bcrypt password storage format.
func IsLegacyMD5Hex(s string) bool {
	return legacyMD5Pattern.MatchString(s)
}

// Verify checks 'submitted' (the password as received by an RPC - under the
// current convention this is the plaintext password) against 'stored' (the
// raw 'password' column value). It reports whether the check succeeded, and
// whether the caller should transparently re-hash 'submitted' with bcrypt
// and persist it over 'stored'.
//
//   - If 'stored' is a bcrypt hash: plain bcrypt comparison. Never upgrades
//     (it is already in the current format).
//   - Otherwise 'stored' is treated as a legacy unsalted MD5 hex digest:
//      - if md5(submitted) == stored, the check succeeds and the caller
//        should upgrade the row to bcrypt(submitted).
//      - else, ONLY as a compatibility fallback for clients that still
//        MD5-hash the password themselves before sending it (this project's
//        pre-FIX-15 admin login page does this): if 'submitted' itself
//        already has the shape of a 32-hex MD5 digest and equals 'stored',
//        the check succeeds, but the row is NOT upgraded - the real
//        plaintext was never seen, so there is nothing safe to bcrypt-hash.
func Verify(submitted string, stored string) (ok bool, needsUpgrade bool) {
	if len(submitted) == 0 || len(stored) == 0 {
		return false, false
	}

	if IsBcryptHash(stored) {
		return bcrypt.CompareHashAndPassword([]byte(stored), []byte(submitted)) == nil, false
	}

	// Legacy row: stored is expected to be md5(realPlaintext).
	if stringutil.Md5(submitted) == stored {
		return true, true
	}

	// Compatibility exception: a client that pre-hashed the password itself
	// sends exactly the stored legacy digest back. We can authenticate it,
	// but we never saw the real plaintext, so we must not upgrade.
	if IsLegacyMD5Hex(submitted) && submitted == stored {
		return true, false
	}

	return false, false
}
