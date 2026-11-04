// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (p *PG) PutIdentityKey(ctx context.Context, userID, keyID, publicKey, label string) (*IdentityKey, error) {
	// upsert only when the same public key is re-published; a different
	// key under an existing id must fail loudly — key changes are
	// deliberate, never silent.
	var k IdentityKey
	err := p.pool.QueryRow(ctx, `
		INSERT INTO device_identity_keys (user_id, key_id, public_key, label)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, key_id) DO UPDATE
		   SET label = EXCLUDED.label, revoked_at = NULL
		 WHERE device_identity_keys.public_key = EXCLUDED.public_key
		RETURNING key_id, public_key, label, created_at`,
		userID, keyID, publicKey, label,
	).Scan(&k.KeyID, &k.PublicKey, &k.Label, &k.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConflict
	}
	if err != nil {
		return nil, err
	}
	return &k, nil
}

func (p *PG) ListIdentityKeys(ctx context.Context, userID string) ([]IdentityKey, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT key_id, public_key, label, created_at
		  FROM device_identity_keys
		 WHERE user_id = $1 AND revoked_at IS NULL
		 ORDER BY created_at`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IdentityKey{}
	for rows.Next() {
		var k IdentityKey
		if err := rows.Scan(&k.KeyID, &k.PublicKey, &k.Label, &k.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (p *PG) RevokeIdentityKey(ctx context.Context, userID, keyID string) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE device_identity_keys SET revoked_at = now()
		 WHERE user_id = $1 AND key_id = $2 AND revoked_at IS NULL`,
		userID, keyID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
