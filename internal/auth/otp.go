// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// OTP — 6-digit codes hashed with Argon2id (x/crypto, already in go.mod).
// Codes are never stored or logged in plaintext outside the sender.

const otpSaltLen = 16

// Generate — returns the plaintext code (for the sender) and its hash
// (for otp_codes.code_hash).
func Generate() (code, hash string, err error) {
	var n [3]byte
	if _, err := rand.Read(n[:]); err != nil {
		return "", "", err
	}
	// 0..999999 from 24 random bits
	code = fmt.Sprintf("%06d", (int(n[0])<<16|int(n[1])<<8|int(n[2]))%1000000)
	hash, err = Hash(code)
	return code, hash, err
}

// Hash — Argon2id(salt || code).
func Hash(code string) (string, error) {
	var salt [otpSaltLen]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(code), salt[:], 1, 64*1024, 4, 32)
	return base64.RawStdEncoding.EncodeToString(salt[:]) + "." +
		base64.RawStdEncoding.EncodeToString(key), nil
}

// Verify — constant-time check of code against the stored hash.
func Verify(code, stored string) bool {
	parts := splitHash(stored)
	if parts == nil {
		return false
	}
	key := argon2.IDKey([]byte(code), parts[0], 1, 64*1024, 4, 32)
	return subtle.ConstantTimeCompare(key, parts[1]) == 1
}

func splitHash(stored string) [][]byte {
	i := strings.IndexByte(stored, '.')
	if i < 0 {
		return nil
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(stored[:i])
	key, err2 := base64.RawStdEncoding.DecodeString(stored[i+1:])
	if err1 != nil || err2 != nil {
		return nil
	}
	return [][]byte{salt, key}
}

// SuggestTagVariants — candidate tags for `tag_taken.details.tagSuggestions`.
// Mirrors the contract: mixed forms — prefix+NNNNN (no '#') and name#NNNN.
func SuggestTagVariants(prefix string) []string {
	if prefix == "" {
		return nil
	}
	var b [8]byte
	_, _ = rand.Read(b[:])
	nums := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		n := int(b[2*i])<<8 | int(b[2*i+1])
		nums = append(nums, fmt.Sprintf("%05d", n%100000))
	}
	return []string{
		prefix + nums[0],
		prefix + nums[1],
		prefix + "#" + nums[2][:4],
	}
}

// TagFromName — normalize a display name into the `name#NNNN` shape.
func TagFromName(prefix string) string {
	var b [2]byte
	_, _ = rand.Read(b[:])
	n, _ := strconv.Atoi(fmt.Sprintf("%02d%02d", b[0]%100, b[1]%100))
	return fmt.Sprintf("%s#%04d", prefix, n%10000)
}
