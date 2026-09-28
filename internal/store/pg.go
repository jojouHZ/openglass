// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PG — production AuthStore over pgx.
type PG struct {
	pool *pgxpool.Pool
}

func NewPG(ctx context.Context, dsn string) (*PG, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PG{pool: pool}, nil
}

func (p *PG) Close() { p.pool.Close() }

func (p *PG) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }

func (p *PG) Pool() *pgxpool.Pool { return p.pool }

const pgUniqueViolation = "23505"

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func (p *PG) UserByEmail(ctx context.Context, email string) (*User, error) {
	u := &User{}
	err := p.pool.QueryRow(ctx,
		`SELECT id, email::text, coalesce(display_name,''), coalesce(tag,''), avatar_url, created_at
		 FROM users WHERE email = $1`, email).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.Tag, &u.AvatarURL, &u.CreatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return u, err
}

func (p *PG) UserByID(ctx context.Context, id string) (*User, error) {
	u := &User{}
	err := p.pool.QueryRow(ctx,
		`SELECT id, email::text, coalesce(display_name,''), coalesce(tag,''), avatar_url, created_at
		 FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.Tag, &u.AvatarURL, &u.CreatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return u, err
}

func (p *PG) TagExists(ctx context.Context, tag string) (bool, error) {
	var exists bool
	err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE tag = $1)`, tag).Scan(&exists)
	return exists, err
}

func (p *PG) CreateUser(ctx context.Context, email string) (*User, error) {
	u := &User{Email: email}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO users (email) VALUES ($1)
		 RETURNING id, coalesce(display_name,''), coalesce(tag,''), avatar_url, created_at`,
		email).
		Scan(&u.ID, &u.DisplayName, &u.Tag, &u.AvatarURL, &u.CreatedAt)
	if isUniqueViolation(err) {
		return nil, ErrConflict
	}
	return u, err
}

func (p *PG) CompleteProfile(ctx context.Context, userID, displayName, tag string) (*User, error) {
	u := &User{ID: userID, DisplayName: displayName, Tag: tag}
	err := p.pool.QueryRow(ctx,
		`UPDATE users SET display_name = $2, tag = $3 WHERE id = $1
		 RETURNING email::text, avatar_url, created_at`,
		userID, displayName, tag).Scan(&u.Email, &u.AvatarURL, &u.CreatedAt)
	if isUniqueViolation(err) {
		return nil, ErrConflict
	}
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return u, err
}

func (p *PG) UpdateProfile(ctx context.Context, userID string, displayName *string, avatarURL *string) (*User, error) {
	u := &User{ID: userID}
	err := p.pool.QueryRow(ctx,
		`UPDATE users SET
		   display_name = coalesce($2, display_name),
		   avatar_url   = CASE WHEN $3::text IS NULL THEN avatar_url ELSE $3 END
		 WHERE id = $1
		 RETURNING email::text, display_name, tag, avatar_url, created_at`,
		userID, displayName, avatarURL).
		Scan(&u.Email, &u.DisplayName, &u.Tag, &u.AvatarURL, &u.CreatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return u, err
}

func (p *PG) SearchUsers(ctx context.Context, q string, limit int) ([]User, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id, email::text, coalesce(display_name,''), coalesce(tag,''), avatar_url, created_at
		 FROM users
		 WHERE display_name ILIKE '%' || $1 || '%' OR tag ILIKE '%' || $1 || '%'
		 ORDER BY tag NULLS LAST LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Tag, &u.AvatarURL, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (p *PG) InviteValid(ctx context.Context, code string) (bool, error) {
	var ok bool
	err := p.pool.QueryRow(ctx,
		`SELECT uses_left > 0 AND (expires_at IS NULL OR expires_at > now())
		 FROM invites WHERE code = $1`, code).Scan(&ok)
	if isNoRows(err) {
		return false, nil
	}
	return ok, err
}

func (p *PG) ConsumeInvite(ctx context.Context, code string) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE invites SET uses_left = uses_left - 1
		 WHERE code = $1 AND uses_left > 0`, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConsumed
	}
	return nil
}

func (p *PG) SaveOtp(ctx context.Context, rec *OtpRecord) error {
	_, err := p.pool.Exec(ctx,
		`INSERT INTO otp_codes (email, code_hash, attempts_left, expires_at, next_resend_at, invite_code)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (email) DO UPDATE SET
		   code_hash = EXCLUDED.code_hash, attempts_left = EXCLUDED.attempts_left,
		   expires_at = EXCLUDED.expires_at, next_resend_at = EXCLUDED.next_resend_at,
		   invite_code = EXCLUDED.invite_code`,
		rec.Email, rec.CodeHash, rec.AttemptsLeft, rec.ExpiresAt, rec.NextResendAt, rec.InviteCode)
	return err
}

func (p *PG) OtpFor(ctx context.Context, email string) (*OtpRecord, error) {
	r := &OtpRecord{Email: email}
	err := p.pool.QueryRow(ctx,
		`SELECT code_hash, attempts_left, expires_at, next_resend_at, invite_code
		 FROM otp_codes WHERE email = $1`, email).
		Scan(&r.CodeHash, &r.AttemptsLeft, &r.ExpiresAt, &r.NextResendAt, &r.InviteCode)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return r, err
}

func (p *PG) DeleteOtp(ctx context.Context, email string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM otp_codes WHERE email = $1`, email)
	return err
}

func (p *PG) DecrementOtpAttempts(ctx context.Context, email string) (int, error) {
	var left int
	err := p.pool.QueryRow(ctx,
		`UPDATE otp_codes SET attempts_left = attempts_left - 1
		 WHERE email = $1 RETURNING attempts_left`, email).Scan(&left)
	if isNoRows(err) {
		return 0, ErrNotFound
	}
	return left, err
}

func (p *PG) CreateSession(ctx context.Context, userID, deviceName string, refreshHash []byte) (*Session, error) {
	s := &Session{UserID: userID, DeviceName: deviceName}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO sessions (user_id, device_name, refresh_hash) VALUES ($1,$2,$3)
		 RETURNING id, created_at, last_seen_at`,
		userID, deviceName, refreshHash).Scan(&s.ID, &s.CreatedAt, &s.LastSeenAt)
	return s, err
}

func (p *PG) SessionByRefreshHash(ctx context.Context, hash []byte) (*Session, bool, error) {
	s := &Session{}
	var revokedAt *time.Time
	err := p.pool.QueryRow(ctx,
		`SELECT id, user_id, device_name, created_at, last_seen_at, revoked_at
		 FROM sessions WHERE refresh_hash = $1`, hash).
		Scan(&s.ID, &s.UserID, &s.DeviceName, &s.CreatedAt, &s.LastSeenAt, &revokedAt)
	if isNoRows(err) {
		return nil, false, ErrNotFound
	}
	return s, revokedAt != nil, err
}

func (p *PG) RotateSessionRefresh(ctx context.Context, sessionID string, newHash []byte) error {
	_, err := p.pool.Exec(ctx,
		`UPDATE sessions SET refresh_hash = $2, last_seen_at = now() WHERE id = $1`,
		sessionID, newHash)
	return err
}

func (p *PG) RevokeSession(ctx context.Context, sessionID string) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
		sessionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *PG) ListSessions(ctx context.Context, userID, currentID string) ([]Session, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id, user_id, device_name, created_at, last_seen_at
		 FROM sessions WHERE user_id = $1 AND revoked_at IS NULL
		 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.UserID, &s.DeviceName, &s.CreatedAt, &s.LastSeenAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
