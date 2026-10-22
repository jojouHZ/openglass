// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"time"
)

// Contact consent model (slice F1). Invariants:
//   - contacts rows exist only as mutual pairs, written together in one tx;
//   - a request is 'pending' or silently 'declined' (hidden from the target,
//     still visible to the requester as pending);
//   - group invites live in group_invites, never in chat_members.

const userCols = `u.id, u.email::text, coalesce(u.display_name,''), coalesce(u.tag,''), u.avatar_url, u.created_at`

func (p *PG) ListContacts(ctx context.Context, userID string) ([]Contact, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT `+userCols+`, c.created_at
		 FROM contacts c JOIN users u ON u.id = c.contact_id
		 WHERE c.owner_id = $1 ORDER BY c.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Contact
	for rows.Next() {
		c := Contact{Mutual: true}
		if err := rows.Scan(&c.User.ID, &c.User.Email, &c.User.DisplayName, &c.User.Tag,
			&c.User.AvatarURL, &c.User.CreatedAt, &c.AddedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (p *PG) RequestContact(ctx context.Context, from, to string) (*ContactRequestResult, error) {
	if from == to {
		return nil, ErrInvalid
	}
	target, err := p.UserByID(ctx, to)
	if err != nil {
		return nil, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// serialise the pair: two simultaneous crossing requests must see each
	// other (one collapses the other into a mutual contact) instead of both
	// reading "no reverse request yet" and both staying pending forever
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended(least($1::text,$2::text) || greatest($1::text,$2::text), 0))`,
		from, to); err != nil {
		return nil, err
	}

	var already bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM contacts WHERE owner_id=$1 AND contact_id=$2)`,
		from, to).Scan(&already); err != nil {
		return nil, err
	}
	if already {
		return nil, ErrConflict
	}

	// the target already asked us (any status): collapse into a mutual contact
	tag, err := tx.Exec(ctx,
		`DELETE FROM contact_requests WHERE requester_id=$1 AND target_id=$2`, to, from)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() > 0 {
		if _, err := tx.Exec(ctx,
			`INSERT INTO contacts (owner_id, contact_id) VALUES ($1,$2), ($2,$1)
			 ON CONFLICT DO NOTHING`, from, to); err != nil {
			return nil, err
		}
		var at time.Time
		if err := tx.QueryRow(ctx,
			`SELECT created_at FROM contacts WHERE owner_id=$1 AND contact_id=$2`,
			from, to).Scan(&at); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &ContactRequestResult{Mutual: true, Contact: &Contact{User: *target, Mutual: true, AddedAt: at}}, nil
	}

	var at time.Time
	err = tx.QueryRow(ctx,
		`INSERT INTO contact_requests (requester_id, target_id) VALUES ($1,$2)
		 ON CONFLICT DO NOTHING RETURNING created_at`, from, to).Scan(&at)
	existing := false
	if isNoRows(err) {
		existing = true // pending or silently declined: resend is a no-op
		err = tx.QueryRow(ctx,
			`SELECT created_at FROM contact_requests WHERE requester_id=$1 AND target_id=$2`,
			from, to).Scan(&at)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &ContactRequestResult{Existing: existing, Request: &ContactRequest{User: *target, CreatedAt: at}}, nil
}

func (p *PG) ListContactRequests(ctx context.Context, userID string) ([]ContactRequest, []ContactRequest, error) {
	load := func(q string) ([]ContactRequest, error) {
		rows, err := p.pool.Query(ctx, q, userID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []ContactRequest
		for rows.Next() {
			var r ContactRequest
			if err := rows.Scan(&r.User.ID, &r.User.Email, &r.User.DisplayName, &r.User.Tag,
				&r.User.AvatarURL, &r.User.CreatedAt, &r.CreatedAt); err != nil {
				return nil, err
			}
			out = append(out, r)
		}
		return out, rows.Err()
	}
	in, err := load(`SELECT ` + userCols + `, r.created_at
		FROM contact_requests r JOIN users u ON u.id = r.requester_id
		WHERE r.target_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`)
	if err != nil {
		return nil, nil, err
	}
	// outgoing includes silently-declined requests: the requester never learns
	out, err := load(`SELECT ` + userCols + `, r.created_at
		FROM contact_requests r JOIN users u ON u.id = r.target_id
		WHERE r.requester_id = $1 ORDER BY r.created_at DESC`)
	return in, out, err
}

func (p *PG) AcceptContactRequest(ctx context.Context, me, requesterID string) (*Contact, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx,
		`DELETE FROM contact_requests WHERE requester_id=$1 AND target_id=$2 AND status='pending'`,
		requesterID, me)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO contacts (owner_id, contact_id) VALUES ($1,$2), ($2,$1)
		 ON CONFLICT DO NOTHING`, me, requesterID); err != nil {
		return nil, err
	}
	c := Contact{Mutual: true}
	if err := tx.QueryRow(ctx,
		`SELECT `+userCols+`, c.created_at FROM contacts c JOIN users u ON u.id=c.contact_id
		 WHERE c.owner_id=$1 AND c.contact_id=$2`, me, requesterID).
		Scan(&c.User.ID, &c.User.Email, &c.User.DisplayName, &c.User.Tag,
			&c.User.AvatarURL, &c.User.CreatedAt, &c.AddedAt); err != nil {
		return nil, err
	}
	return &c, tx.Commit(ctx)
}

func (p *PG) DeclineContactRequest(ctx context.Context, me, requesterID string) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE contact_requests SET status='declined', updated_at=now()
		 WHERE requester_id=$1 AND target_id=$2 AND status='pending'`, requesterID, me)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *PG) CancelContactRequest(ctx context.Context, me, targetID string) error {
	tag, err := p.pool.Exec(ctx,
		`DELETE FROM contact_requests WHERE requester_id=$1 AND target_id=$2`, me, targetID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *PG) RemoveContact(ctx context.Context, userID, contactID string) error {
	tag, err := p.pool.Exec(ctx,
		`DELETE FROM contacts WHERE (owner_id=$1 AND contact_id=$2) OR (owner_id=$2 AND contact_id=$1)`,
		userID, contactID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *PG) AreMutual(ctx context.Context, a, b string) (bool, error) {
	var ok bool
	err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM contacts WHERE owner_id=$1 AND contact_id=$2)
		   AND EXISTS(SELECT 1 FROM contacts WHERE owner_id=$2 AND contact_id=$1)`,
		a, b).Scan(&ok)
	return ok, err
}

func (p *PG) Relationship(ctx context.Context, a, b string) (string, error) {
	if a == b {
		return "self", nil
	}
	var mutual, out, in bool
	err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM contacts WHERE owner_id=$1 AND contact_id=$2),
		        EXISTS(SELECT 1 FROM contact_requests WHERE requester_id=$1 AND target_id=$2),
		        EXISTS(SELECT 1 FROM contact_requests WHERE requester_id=$2 AND target_id=$1 AND status='pending')`,
		a, b).Scan(&mutual, &out, &in)
	switch {
	case err != nil:
		return "none", err
	case mutual:
		return "contact_mutual", nil
	case out:
		return "contact_outgoing", nil
	case in:
		return "contact_incoming", nil
	}
	return "none", nil
}

func (p *PG) MutualContactIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT contact_id FROM contacts WHERE owner_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (p *PG) ListGroupInvites(ctx context.Context, userID string) ([]GroupInvite, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT gi.chat_id, coalesce(c.title,''),
		        (SELECT count(*) FROM chat_members x WHERE x.chat_id = c.id),
		        `+userCols+`, gi.created_at
		 FROM group_invites gi
		 JOIN chats c ON c.id = gi.chat_id
		 JOIN users u ON u.id = gi.inviter_id
		 WHERE gi.invitee_id = $1 AND gi.status = 'pending'
		 ORDER BY gi.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupInvite
	for rows.Next() {
		var gi GroupInvite
		if err := rows.Scan(&gi.ChatID, &gi.Title, &gi.MemberCount, &gi.Inviter.ID, &gi.Inviter.Email,
			&gi.Inviter.DisplayName, &gi.Inviter.Tag, &gi.Inviter.AvatarURL, &gi.Inviter.CreatedAt,
			&gi.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, gi)
	}
	return out, rows.Err()
}

func (p *PG) AcceptGroupInvite(ctx context.Context, chatID, userID string) (*Chat, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx,
		`DELETE FROM group_invites WHERE chat_id=$1 AND invitee_id=$2 AND status='pending'`,
		chatID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		chatID, userID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return p.ChatByID(ctx, chatID, userID)
}

func (p *PG) DeclineGroupInvite(ctx context.Context, chatID, userID string) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE group_invites SET status='declined'
		 WHERE chat_id=$1 AND invitee_id=$2 AND status='pending'`, chatID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
