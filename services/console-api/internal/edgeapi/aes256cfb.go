// Copyright (c) 2020, LiuXiangChao. All rights reserved.
// Use of this source code is governed by the BSD 3-Clause License that can be
// found in edge-api/LICENSE. Adapted from EdgeAPI internal/encrypt
// (method_aes_256_cfb.go) for the Hcdn console-api.

package edgeapi

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"errors"
)

// aes256CFB is EdgeAPI's "aes-256-cfb" token method (teaconst.EncryptMethod).
// The key is the API token secret, the IV is the node id; both are padded with
// spaces or truncated to 32 and 16 bytes respectively.
type aes256CFB struct {
	block cipher.Block
	iv    []byte
}

func newAES256CFB(key, iv []byte) (*aes256CFB, error) {
	key = fitBytes(key, 32)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return &aes256CFB{block: block, iv: fitBytes(iv, aes.BlockSize)}, nil
}

func fitBytes(b []byte, n int) []byte {
	out := make([]byte, 0, n)
	if len(b) >= n {
		return append(out, b[:n]...)
	}
	out = append(out, b...)
	return append(out, bytes.Repeat([]byte{' '}, n-len(b))...)
}

func (m *aes256CFB) Encrypt(src []byte) ([]byte, error) {
	if len(src) == 0 {
		return nil, errors.New("empty plaintext")
	}
	dst := make([]byte, len(src))
	cipher.NewCFBEncrypter(m.block, m.iv).XORKeyStream(dst, src) //nolint:staticcheck // wire-compatible with EdgeAPI
	return dst, nil
}

func (m *aes256CFB) Decrypt(src []byte) ([]byte, error) {
	if len(src) == 0 {
		return nil, errors.New("empty ciphertext")
	}
	dst := make([]byte, len(src))
	cipher.NewCFBDecrypter(m.block, m.iv).XORKeyStream(dst, src) //nolint:staticcheck // wire-compatible with EdgeAPI
	return dst, nil
}
