// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"encoding/json"
)

// AddSystemMessage appends a structured event to a chat's timeline. The actor
// is the sender (so unread counting and ordering work like any message); the
// text stays NULL — clients render the sentence for the viewer.
func (p *PG) AddSystemMessage(ctx context.Context, chatID, actorID string, ev SystemEvent) (*Message, error) {
	raw, err := json.Marshal(ev)
	if err != nil {
		return nil, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var seq int64
	if err := tx.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq`,
		chatID).Scan(&seq); err != nil {
		if isNoRows(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	m, err := p.scanMsg(tx.QueryRow(ctx,
		`INSERT INTO messages (chat_id, sender_id, seq, text, client_nonce, kind, system_event)
		 VALUES ($1,$2,$3,NULL,'sys-' || gen_random_uuid()::text,'system',$4)
		 RETURNING `+msgCols, chatID, actorID, seq, raw))
	if err != nil {
		return nil, err
	}
	return m, tx.Commit(ctx)
}

func (p *PG) DirectChatBetween(ctx context.Context, a, b string) (string, bool, error) {
	var id string
	err := p.pool.QueryRow(ctx, `SELECT id FROM chats WHERE direct_key = $1`, directKey(a, b)).Scan(&id)
	if isNoRows(err) {
		return "", false, nil
	}
	return id, err == nil, err
}
