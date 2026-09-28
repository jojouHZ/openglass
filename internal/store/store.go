// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package store — auth-layer persistence.
//
// Store is the consumer-facing interface (used by internal/api);
// PG implements it over pgx, Mem backs contract tests.
package store

import (
	"context"
	"errors"
	"time"
)

// Domain types — field names mirror the API contract (camelCase JSON
// handled at the api boundary, these stay Go-shaped).

type User struct {
	ID          string
	Email       string
	DisplayName string // "" until completeProfile
	Tag         string // "" until bound
	AvatarURL   *string
	CreatedAt   time.Time
}

type OtpRecord struct {
	Email        string
	CodeHash     string
	AttemptsLeft int
	ExpiresAt    time.Time
	NextResendAt time.Time
	InviteCode   *string // pending invite — consumed at verify
}

type Session struct {
	ID         string
	UserID     string
	DeviceName string
	CreatedAt  time.Time
	LastSeenAt time.Time
}

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
	ErrConsumed = errors.New("invite consumed")
)

// AuthStore — the persistence surface the API layer needs.
// Kept narrow on purpose: chat/message ops join with their slices.
type AuthStore interface {
	// users
	UserByEmail(ctx context.Context, email string) (*User, error)
	UserByID(ctx context.Context, id string) (*User, error)
	TagExists(ctx context.Context, tag string) (bool, error)
	CreateUser(ctx context.Context, email string) (*User, error)
	CompleteProfile(ctx context.Context, userID, displayName, tag string) (*User, error)
	UpdateProfile(ctx context.Context, userID string, displayName *string, avatarURL *string) (*User, error)
	SearchUsers(ctx context.Context, q string, limit int) ([]User, error)

	// invites
	InviteValid(ctx context.Context, code string) (bool, error)
	ConsumeInvite(ctx context.Context, code string) error // inside verify tx

	// otp
	SaveOtp(ctx context.Context, rec *OtpRecord) error
	OtpFor(ctx context.Context, email string) (*OtpRecord, error)
	DeleteOtp(ctx context.Context, email string) error
	DecrementOtpAttempts(ctx context.Context, email string) (int, error)

	// sessions
	CreateSession(ctx context.Context, userID, deviceName string, refreshHash []byte) (*Session, error)
	SessionByRefreshHash(ctx context.Context, hash []byte) (*Session, bool /*revoked*/, error)
	RotateSessionRefresh(ctx context.Context, sessionID string, newHash []byte) error
	RevokeSession(ctx context.Context, sessionID string) error
	// SessionActive — false when revoked or absent (middleware gate).
	SessionActive(ctx context.Context, sessionID string) (bool, error)
	ListSessions(ctx context.Context, userID, currentID string) ([]Session, error)
}
