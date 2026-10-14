// Package securerand generates random strings for secrets (node/cluster/API
// secrets, access keys, tokens, login tickets, setup credentials, ...) using
// crypto/rand instead of math/rand (FIX-16).
//
// Previously these values were generated with TeaGo's rands package
// (github.com/iwind/TeaGo/rands), which is backed by a math/rand source
// seeded once from time.Now().UnixNano(). That source is not
// cryptographically secure: its output is fully determined by its seed, and
// the seed space is small enough to be brute-forced, so secrets generated
// this way are guessable.
//
// RandString and RandHexString draw from the exact same alphabets as
// rands.String and rands.HexString respectively, so callers can swap them in
// without changing the length or shape (and therefore the format) of
// existing secrets.
package securerand

import (
	"crypto/rand"
	"math/big"
)

const (
	// letterChars matches TeaGo rands.String's alphabet.
	letterChars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	// hexChars matches TeaGo rands.HexString's alphabet.
	hexChars = "0123456789abcdef"
)

// RandString returns a cryptographically secure random string of length n,
// drawn from the same [0-9a-zA-Z] alphabet as TeaGo's rands.String.
func RandString(n int) string {
	return randStringFromAlphabet(n, letterChars)
}

// RandHexString returns a cryptographically secure random lowercase-hex
// string of length n, drawn from the same [0-9a-f] alphabet as TeaGo's
// rands.HexString.
func RandHexString(n int) string {
	return randStringFromAlphabet(n, hexChars)
}

// randStringFromAlphabet returns a string of length n whose bytes are drawn
// uniformly (no modulo bias) from alphabet using crypto/rand.
func randStringFromAlphabet(n int, alphabet string) string {
	if n <= 0 {
		return ""
	}

	var alphabetLen = big.NewInt(int64(len(alphabet)))
	var b = make([]byte, n)
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, alphabetLen)
		if err != nil {
			// crypto/rand.Reader failing means the OS CSPRNG is unavailable,
			// which should not happen in practice. Panic rather than
			// silently falling back to a weak source for secrets.
			panic("securerand: crypto/rand unavailable: " + err.Error())
		}
		b[i] = alphabet[idx.Int64()]
	}
	return string(b)
}
