package edgeapi

import (
	"encoding/base64"
	"testing"
	"time"
)

// Known-answer vectors produced with EdgeAPI's own internal/encrypt
// ("aes-256-cfb" via encrypt.NewMethodInstance(teaconst.EncryptMethod, secret, nodeId)).
func TestEncryptMatchesEdgeAPI(t *testing.T) {
	cases := []struct {
		secret, nodeID, plain, want string
	}{
		{
			"s3cr3t-0123456789abcdef0123456789abcdefXYZ", "c0ffee00c0ffee00c0ffee00c0ffee00",
			`{"timestamp":1700000000,"type":"user","userId":42}`,
			"n73HJzwQvzqmfOt73YmjYX1FiTPetPOniJX5hyQZu773yIqKMwfVaCJLPmUtF0vYCMg=",
		},
		{
			"short", "n1", `{"timestamp":1,"type":"admin","userId":1}`,
			"128XLHh7nwOT3riIxvjA097/EFWzH8G+27t0BBhRgtf1CHrUsn2XFUQ=",
		},
	}
	for _, c := range cases {
		m, err := newAES256CFB([]byte(c.secret), []byte(c.nodeID))
		if err != nil {
			t.Fatal(err)
		}
		enc, err := m.Encrypt([]byte(c.plain))
		if err != nil {
			t.Fatal(err)
		}
		if got := base64.StdEncoding.EncodeToString(enc); got != c.want {
			t.Fatalf("encrypt mismatch:\n got %s\nwant %s", got, c.want)
		}
		raw, _ := base64.StdEncoding.DecodeString(c.want)
		dec, err := m.Decrypt(raw)
		if err != nil || string(dec) != c.plain {
			t.Fatalf("decrypt mismatch: %q %v", dec, err)
		}
	}
}

func TestTokenRoundTrip(t *testing.T) {
	cred := Credential{NodeID: "c0ffee00c0ffee00c0ffee00c0ffee00", Secret: "s3cr3t-0123456789abcdef0123456789abcdefXYZ"}
	now := time.Unix(1700000000, 0)
	tok, err := EncodeToken(cred, RoleUser, 42, now)
	if err != nil {
		t.Fatal(err)
	}
	// Same payload as the EdgeAPI vector above => identical ciphertext.
	if tok != "n73HJzwQvzqmfOt73YmjYX1FiTPetPOniJX5hyQZu773yIqKMwfVaCJLPmUtF0vYCMg=" {
		t.Fatalf("token differs from EdgeAPI encoding: %s", tok)
	}
	m, err := DecodeToken(cred, tok)
	if err != nil {
		t.Fatal(err)
	}
	if m["type"] != "user" || m["userId"].(float64) != 42 || m["timestamp"].(float64) != 1700000000 {
		t.Fatalf("bad payload %v", m)
	}
}

func TestAsUserRejectsZero(t *testing.T) {
	c, err := New(Options{Endpoints: []string{"http://127.0.0.1:1"}, User: Credential{NodeID: "n", Secret: "s"}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if _, err := c.AsUser(t.Context(), 0); err == nil {
		t.Fatal("AsUser(0) must fail: EdgeAPI skips ownership checks for userId 0")
	}
	if _, err := c.AsAdmin(t.Context(), 1); err == nil {
		t.Fatal("AsAdmin without admin credential must fail")
	}
}
