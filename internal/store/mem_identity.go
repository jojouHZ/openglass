// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"sort"
	"time"
)

func (m *Mem) PutIdentityKey(_ context.Context, userID, keyID, publicKey, label string) (*IdentityKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.identityKeys == nil {
		m.identityKeys = map[string]map[string]*identityKeyRow{}
	}
	keys := m.identityKeys[userID]
	if keys == nil {
		keys = map[string]*identityKeyRow{}
		m.identityKeys[userID] = keys
	}
	if row, ok := keys[keyID]; ok {
		if row.k.PublicKey != publicKey {
			return nil, ErrConflict
		}
		row.revoked = false // re-publish of the same key is idempotent
		row.k.Label = label
		return &row.k, nil
	}
	k := IdentityKey{KeyID: keyID, PublicKey: publicKey, Label: label, CreatedAt: time.Now()}
	keys[keyID] = &identityKeyRow{k: k}
	return &k, nil
}

func (m *Mem) ListIdentityKeys(_ context.Context, userID string) ([]IdentityKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []IdentityKey{}
	for _, row := range m.identityKeys[userID] {
		if !row.revoked {
			out = append(out, row.k)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (m *Mem) RevokeIdentityKey(_ context.Context, userID, keyID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.identityKeys[userID][keyID]
	if !ok || row.revoked {
		return ErrNotFound
	}
	row.revoked = true
	return nil
}
