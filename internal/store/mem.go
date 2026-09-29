// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"time"
)

// Mem — in-memory AuthStore for contract tests and `go test` without PG.
// Not for production: no persistence, no TTL sweeps (expiry is checked
// on read though).
type Mem struct {
	mu       sync.Mutex
	users    map[string]*User // by id
	invites  map[string]*invite
	otps     map[string]*OtpRecord
	sessions map[string]*memSession

	chatOnce sync.Once
	chats    *memChats // messaging slice — mem_chats.go
}

type invite struct {
	usesLeft int
	expires  *time.Time
}

type memSession struct {
	Session
	refreshHash []byte
	revokedAt   *time.Time
}

func NewMem() *Mem {
	return &Mem{
		users:    map[string]*User{},
		invites:  map[string]*invite{},
		otps:     map[string]*OtpRecord{},
		sessions: map[string]*memSession{},
	}
}

// SeedInvite — test helper: add a valid invite code.
func (m *Mem) SeedInvite(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.invites[code] = &invite{usesLeft: 1}
}

func memID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[0:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" +
		hex.EncodeToString(b[10:16])
}

func (m *Mem) UserByEmail(_ context.Context, email string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if strings.EqualFold(u.Email, email) {
			cp := *u
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (m *Mem) UserByID(_ context.Context, id string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *u
	return &cp, nil
}

func (m *Mem) TagExists(_ context.Context, tag string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if strings.EqualFold(u.Tag, tag) {
			return true, nil
		}
	}
	return false, nil
}

func (m *Mem) CreateUser(_ context.Context, email string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if strings.EqualFold(u.Email, email) {
			return nil, ErrConflict
		}
	}
	u := &User{ID: memID(), Email: email, CreatedAt: time.Now()}
	m.users[u.ID] = u
	cp := *u
	return &cp, nil
}

func (m *Mem) CompleteProfile(_ context.Context, userID, displayName, tag string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[userID]
	if !ok {
		return nil, ErrNotFound
	}
	for _, o := range m.users {
		if o.ID != userID && strings.EqualFold(o.Tag, tag) {
			return nil, ErrConflict
		}
	}
	u.DisplayName = displayName
	u.Tag = tag
	cp := *u
	return &cp, nil
}

func (m *Mem) UpdateProfile(_ context.Context, userID string, displayName *string, avatarURL *string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	u, ok := m.users[userID]
	if !ok {
		return nil, ErrNotFound
	}
	if displayName != nil {
		u.DisplayName = *displayName
	}
	if avatarURL != nil {
		u.AvatarURL = avatarURL
	}
	cp := *u
	return &cp, nil
}

func (m *Mem) SearchUsers(_ context.Context, q string, limit int) ([]User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []User
	lq := strings.ToLower(q)
	for _, u := range m.users {
		if strings.Contains(strings.ToLower(u.DisplayName), lq) ||
			strings.Contains(strings.ToLower(u.Tag), lq) {
			out = append(out, *u)
		}
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Mem) InviteValid(_ context.Context, code string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	inv, ok := m.invites[code]
	if !ok || inv.usesLeft <= 0 {
		return false, nil
	}
	return inv.expires == nil || inv.expires.After(time.Now()), nil
}

func (m *Mem) ConsumeInvite(_ context.Context, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	inv, ok := m.invites[code]
	if !ok || inv.usesLeft <= 0 {
		return ErrConsumed
	}
	inv.usesLeft--
	return nil
}

func (m *Mem) SaveOtp(_ context.Context, rec *OtpRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *rec
	m.otps[strings.ToLower(rec.Email)] = &cp
	return nil
}

func (m *Mem) OtpFor(_ context.Context, email string) (*OtpRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.otps[strings.ToLower(email)]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *r
	return &cp, nil
}

func (m *Mem) DeleteOtp(_ context.Context, email string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.otps, strings.ToLower(email))
	return nil
}

func (m *Mem) DecrementOtpAttempts(_ context.Context, email string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.otps[strings.ToLower(email)]
	if !ok {
		return 0, ErrNotFound
	}
	r.AttemptsLeft--
	return r.AttemptsLeft, nil
}

func (m *Mem) CreateSession(_ context.Context, userID, deviceName string, refreshHash []byte) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := &memSession{
		Session: Session{
			ID: memID(), UserID: userID, DeviceName: deviceName,
			CreatedAt: time.Now(), LastSeenAt: time.Now(),
		},
		refreshHash: refreshHash,
	}
	m.sessions[s.ID] = s
	return &s.Session, nil
}

func (m *Mem) SessionByRefreshHash(_ context.Context, hash []byte) (*Session, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if bytes.Equal(s.refreshHash, hash) {
			cp := s.Session
			return &cp, s.revokedAt != nil, nil
		}
	}
	return nil, false, ErrNotFound
}

func (m *Mem) RotateSessionRefresh(_ context.Context, sessionID string, newHash []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return ErrNotFound
	}
	s.refreshHash = newHash
	s.LastSeenAt = time.Now()
	return nil
}

func (m *Mem) RevokeSession(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[sessionID]
	if !ok || s.revokedAt != nil {
		return ErrNotFound
	}
	now := time.Now()
	s.revokedAt = &now
	return nil
}

func (m *Mem) SessionActive(_ context.Context, sessionID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[sessionID]
	return ok && s.revokedAt == nil, nil
}

func (m *Mem) ListSessions(_ context.Context, userID, _ string) ([]Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Session
	for _, s := range m.sessions {
		if s.UserID == userID && s.revokedAt == nil {
			out = append(out, s.Session)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
