// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"sort"
	"time"
)

// Invite — an invite code as the operator sees it.
type Invite struct {
	Code      string
	UsesLeft  int
	ExpiresAt *time.Time
}

// AdminStore — the operator surface (cmd/ogadmin). Deliberately not part of
// any HTTP handler: it needs database credentials, so it is operator-only
// by construction.
type AdminStore interface {
	ListReports(ctx context.Context, status string) ([]Report, error)
	ResolveReport(ctx context.Context, id, note string) error
	// CreateInvite — ErrConflict when the code already exists.
	CreateInvite(ctx context.Context, code string, uses int, expires *time.Time) error
	ListInvites(ctx context.Context) ([]Invite, error)
}

func (p *PG) CreateInvite(ctx context.Context, code string, uses int, expires *time.Time) error {
	tag, err := p.pool.Exec(ctx,
		`INSERT INTO invites (code, uses_left, expires_at) VALUES ($1,$2,$3)
		 ON CONFLICT (code) DO NOTHING`, code, uses, expires)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

func (p *PG) ListInvites(ctx context.Context) ([]Invite, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT code, uses_left, expires_at FROM invites ORDER BY expires_at NULLS LAST, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		var i Invite
		if err := rows.Scan(&i.Code, &i.UsesLeft, &i.ExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (m *Mem) CreateInvite(_ context.Context, code string, uses int, expires *time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.invites[code]; ok {
		return ErrConflict
	}
	m.invites[code] = &invite{usesLeft: uses, expires: expires}
	return nil
}

func (m *Mem) ListInvites(_ context.Context) ([]Invite, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Invite, 0, len(m.invites))
	for code, inv := range m.invites {
		out = append(out, Invite{Code: code, UsesLeft: inv.usesLeft, ExpiresAt: inv.expires})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out, nil
}
