// Package totp implements RFC 6238 time-based one-time passwords
// (HMAC-SHA-1, 30 s step, 6 digits) as used by GoEdge's OTP login.
package totp

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

const (
	step   = 30
	digits = 6
)

// DecodeSecret parses a base32 secret (case-insensitive, padding optional,
// spaces ignored).
func DecodeSecret(secret string) ([]byte, error) {
	s := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	s = strings.TrimRight(s, "=")
	if s == "" {
		return nil, fmt.Errorf("empty secret")
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
}

// Code returns the HOTP value for a counter.
func Code(key []byte, counter uint64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", digits, bin%1000000)
}

// At returns the code for time t.
func At(key []byte, t time.Time) string {
	return Code(key, uint64(t.Unix())/step)
}

// Verify checks a 6-digit code against t with a ±1 step window.
func Verify(secret, code string, t time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != digits {
		return false
	}
	for _, ch := range code {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	key, err := DecodeSecret(secret)
	if err != nil || len(key) == 0 {
		return false
	}
	c := uint64(t.Unix()) / step
	ok := 0
	for _, d := range []int64{-1, 0, 1} {
		n := int64(c) + d
		if n < 0 {
			continue
		}
		ok |= subtle.ConstantTimeCompare([]byte(Code(key, uint64(n))), []byte(code))
	}
	return ok == 1
}
