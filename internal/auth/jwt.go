// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package auth — token pairs (HS256 JWT access + opaque refresh) and OTP.
package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenPair — the contract's verify/refresh response shape.
type TokenPair struct {
	AccessToken           string
	AccessTokenExpiresInS int
	RefreshToken          string
	SessionID             string // internal — used to bind the refresh row
}

type Tokens struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewTokens(secret []byte, accessTTL, refreshTTL time.Duration) *Tokens {
	return &Tokens{secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

type accessClaims struct {
	jwt.RegisteredClaims
	SessionID string `json:"sid"`
}

// NewPair — issue a fresh access+refresh pair for a session.
// The refresh token is opaque; the server stores only sha256(refresh).
func (t *Tokens) NewPair(userID, sessionID string) (*TokenPair, error) {
	now := time.Now()
	claims := accessClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.accessTTL)),
		},
		SessionID: sessionID,
	}
	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString(t.secret)
	if err != nil {
		return nil, err
	}
	var rb [32]byte
	if _, err := rand.Read(rb[:]); err != nil {
		return nil, err
	}
	return &TokenPair{
		AccessToken:           access,
		AccessTokenExpiresInS: int(t.accessTTL.Seconds()),
		RefreshToken:          base64.RawURLEncoding.EncodeToString(rb[:]),
		SessionID:             sessionID,
	}, nil
}

// RefreshExpiry — store-side expiry cutoff for refresh tokens.
func (t *Tokens) RefreshExpiry() time.Duration { return t.refreshTTL }

// ParseAccess — validate an access token, return (userID, sessionID, exp).
// exp feeds the ws watchdog: a connection is dropped (4401) the moment its
// token expires instead of living until the next read.
func (t *Tokens) ParseAccess(token string) (userID, sessionID string, exp time.Time, err error) {
	claims := &accessClaims{}
	_, err = jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) {
		return t.secret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("invalid token: %w", err)
	}
	return claims.Subject, claims.SessionID, claims.ExpiresAt.Time, nil
}
