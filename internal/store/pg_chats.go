// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// PG ChatStore implementation — messaging persistence.

func (p *PG) IsChatMember(ctx context.Context, chatID, userID string) (bool, error) {
	var ok bool
	err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2)`,
		chatID, userID).Scan(&ok)
	return ok, err
}

func (p *PG) ChatMemberIDs(ctx context.Context, chatID string) ([]string, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT user_id FROM chat_members WHERE chat_id=$1`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (p *PG) ListChatSummaries(ctx context.Context, userID string) ([]ChatSummary, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT c.id, c.type, c.title, c.created_at, mm.pinned,
		        (SELECT count(*) FROM chat_members x WHERE x.chat_id = c.id),
		        coalesce((
		          SELECT count(*) FROM messages x
		          WHERE x.chat_id = c.id AND x.deleted_at IS NULL
		            AND x.seq > mm.last_read_seq AND x.sender_id <> $1), 0),
		        lm.id, lm.seq, lm.sender_id, lm.text, lm.reply_to, lm.client_nonce,
		        lm.sent_at, lm.edited_at, lm.pinned, lm.kind, lm.system_event,
		        coalesce(lm.sent_at, c.created_at),
		        pu.id, pu.email::text, coalesce(pu.display_name,''), coalesce(pu.tag,''),
		        pu.avatar_url, pu.created_at
		 FROM chat_members mm
		 JOIN chats c ON c.id = mm.chat_id
		 LEFT JOIN LATERAL (
		   SELECT * FROM messages m WHERE m.chat_id = c.id AND m.deleted_at IS NULL
		   ORDER BY m.seq DESC LIMIT 1
		 ) lm ON true
		 LEFT JOIN chat_members pm
		   ON pm.chat_id = c.id AND c.type = 'direct' AND pm.user_id <> $1
		 LEFT JOIN users pu ON pu.id = pm.user_id
		 WHERE mm.user_id = $1
		 ORDER BY mm.pinned DESC, coalesce(lm.sent_at, c.created_at) DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ChatSummary
	var self *User
	for rows.Next() {
		var s ChatSummary
		var lm struct {
			id, senderID, clientNonce *string
			seq                       *int64
			text, replyTo             *string
			sentAt, editedAt          *time.Time
			pinned                    *bool
			kind                      *string
			event                     []byte
		}
		var pu struct {
			id, email, dn, tag *string
			avatar             *string
			created            *time.Time
		}
		var title *string
		err := rows.Scan(&s.ID, &s.Type, &title, &s.CreatedAt, &s.Pinned,
			&s.MemberCount, &s.UnreadCount,
			&lm.id, &lm.seq, &lm.senderID, &lm.text, &lm.replyTo, &lm.clientNonce,
			&lm.sentAt, &lm.editedAt, &lm.pinned, &lm.kind, &lm.event,
			&s.LastActivityAt,
			&pu.id, &pu.email, &pu.dn, &pu.tag, &pu.avatar, &pu.created)
		if err != nil {
			return nil, err
		}
		s.Title = title
		if lm.id != nil {
			s.LastMessage = &Message{
				ID: *lm.id, ChatID: s.ID, Seq: *lm.seq, SenderID: *lm.senderID,
				Text: lm.text, ReplyToMessageID: lm.replyTo, ClientNonce: *lm.clientNonce,
				SentAt: *lm.sentAt, EditedAt: lm.editedAt, Pinned: *lm.pinned,
			}
			if lm.kind != nil {
				s.LastMessage.Kind = *lm.kind
			}
			s.LastMessage.setEvent(lm.event)
		}
		if s.Type == "direct" {
			if pu.id != nil {
				s.Peer = &User{ID: *pu.id, Email: *pu.email, DisplayName: *pu.dn,
					Tag: *pu.tag, AvatarURL: pu.avatar, CreatedAt: *pu.created}
			} else {
				// self-chat (saved messages) has a single member row → peer = me
				if self == nil {
					if u, err := p.UserByID(ctx, userID); err == nil {
						self = u
					}
				}
				s.Peer = self
			}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (p *PG) ChatByID(ctx context.Context, chatID, userID string) (*Chat, error) {
	member, err := p.IsChatMember(ctx, chatID, userID)
	if err != nil || !member {
		if err == nil {
			err = ErrNotFound
		}
		return nil, err
	}
	c := &Chat{}
	err = p.pool.QueryRow(ctx,
		`SELECT id, type, title, created_at FROM chats WHERE id = $1`, chatID).
		Scan(&c.ID, &c.Type, &c.Title, &c.CreatedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if c.Type == "direct" {
		var peerID string
		err = p.pool.QueryRow(ctx,
			`SELECT user_id FROM chat_members WHERE chat_id=$1 AND user_id<>$2 LIMIT 1`,
			chatID, userID).Scan(&peerID)
		if isNoRows(err) {
			peerID = userID // self-chat
		} else if err != nil {
			return nil, err
		}
		u, err := p.UserByID(ctx, peerID)
		if err != nil {
			return nil, err
		}
		c.Peer = u
		return c, nil
	}
	// group: full member list
	rows, err := p.pool.Query(ctx,
		`SELECT u.id, u.email::text, coalesce(u.display_name,''), coalesce(u.tag,''),
		        u.avatar_url, u.created_at, cm.role, cm.rights, cm.joined_at
		 FROM chat_members cm JOIN users u ON u.id = cm.user_id
		 WHERE cm.chat_id = $1 ORDER BY cm.joined_at`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var gm GroupMember
		var rights []byte
		if err := rows.Scan(&gm.User.ID, &gm.User.Email, &gm.User.DisplayName, &gm.User.Tag,
			&gm.User.AvatarURL, &gm.User.CreatedAt, &gm.Role, &rights, &gm.JoinedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(rights, &gm.Rights)
		c.Members = append(c.Members, gm)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	inv, err := p.pool.Query(ctx,
		`SELECT u.id, u.email::text, coalesce(u.display_name,''), coalesce(u.tag,''),
		        u.avatar_url, u.created_at
		 FROM group_invites gi JOIN users u ON u.id = gi.invitee_id
		 WHERE gi.chat_id = $1 ORDER BY gi.created_at`, chatID)
	if err != nil {
		return nil, err
	}
	defer inv.Close()
	for inv.Next() {
		var u User
		if err := inv.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Tag, &u.AvatarURL, &u.CreatedAt); err != nil {
			return nil, err
		}
		c.Invited = append(c.Invited, u)
	}
	return c, inv.Err()
}

func (p *PG) OpenDirectChat(ctx context.Context, me, peerID string) (*Chat, bool, error) {
	if _, err := p.UserByID(ctx, peerID); err != nil {
		return nil, false, err
	}
	self := me == peerID
	if !self {
		mutual, err := p.AreMutual(ctx, me, peerID)
		if err != nil {
			return nil, false, err
		}
		if !mutual {
			return nil, false, ErrForbidden
		}
	}
	key := directKey(me, peerID)

	var existing string
	err := p.pool.QueryRow(ctx,
		`SELECT id FROM chats WHERE direct_key = $1`, key).Scan(&existing)
	if err == nil {
		c, err := p.ChatByID(ctx, existing, me)
		return c, false, err
	}
	if !isNoRows(err) {
		return nil, false, err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var chatID string
	var createdAt time.Time
	err = tx.QueryRow(ctx,
		`INSERT INTO chats (type, direct_key) VALUES ('direct', $1)
		 ON CONFLICT (direct_key) DO NOTHING
		 RETURNING id, created_at`, key).Scan(&chatID, &createdAt)
	if isNoRows(err) {
		// lost the race — the other tx created it
		_ = tx.Rollback(ctx)
		c, err := p.ChatByID(ctx, func() string {
			var id string
			_ = p.pool.QueryRow(ctx, `SELECT id FROM chats WHERE direct_key=$1`, key).Scan(&id)
			return id
		}(), me)
		return c, false, err
	}
	if err != nil {
		return nil, false, err
	}
	// self-chat: one member row; normal direct: both parties
	for uid := range map[string]bool{me: true, peerID: true} {
		if _, err := tx.Exec(ctx,
			`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2)`,
			chatID, uid); err != nil {
			return nil, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	c, err := p.ChatByID(ctx, chatID, me)
	return c, true, err
}

func (p *PG) SetChatPinned(ctx context.Context, chatID, userID string, pinned bool) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE chat_members SET pinned=$3 WHERE chat_id=$1 AND user_id=$2`,
		chatID, userID, pinned)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

const msgCols = `id, chat_id, seq, sender_id, text, reply_to, client_nonce, sent_at, edited_at, deleted_at, pinned, kind, system_event`

func (p *PG) scanMsg(row pgx.Row) (*Message, error) {
	m := &Message{}
	var ev []byte
	err := row.Scan(&m.ID, &m.ChatID, &m.Seq, &m.SenderID, &m.Text,
		&m.ReplyToMessageID, &m.ClientNonce, &m.SentAt, &m.EditedAt, &m.DeletedAt, &m.Pinned,
		&m.Kind, &ev)
	if err == nil {
		m.setEvent(ev)
		m.redact()
	}
	return m, err
}

// setEvent decodes the system_event column.
func (m *Message) setEvent(raw []byte) {
	if len(raw) == 0 {
		return
	}
	var ev SystemEvent
	if json.Unmarshal(raw, &ev) == nil {
		m.SystemEvent = &ev
	}
}

func (p *PG) attachFor(ctx context.Context, chatID string, msgs []Message) error {
	if len(msgs) == 0 {
		return nil
	}
	ids := make([]string, len(msgs))
	for i := range msgs {
		ids[i] = msgs[i].ID
	}
	rows, err := p.pool.Query(ctx,
		`SELECT id, chat_id, uploader_id, kind, mime_type, coalesce(file_name,''), size_bytes, coalesce(storage_path,''), created_at, message_id
		 FROM attachments WHERE message_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	byMsg := map[string][]Attachment{}
	for rows.Next() {
		var a Attachment
		var msgID *string
		if err := rows.Scan(&a.ID, &a.ChatID, &a.UploaderID, &a.Kind, &a.MimeType,
			&a.FileName, &a.SizeBytes, &a.StoragePath, &a.CreatedAt, &msgID); err != nil {
			return err
		}
		if msgID != nil {
			byMsg[*msgID] = append(byMsg[*msgID], a)
		}
	}
	for i := range msgs {
		msgs[i].Attachments = byMsg[msgs[i].ID]
		msgs[i].redact()
	}
	return rows.Err()
}

func (p *PG) attachOne(ctx context.Context, m *Message) {
	tmp := []Message{*m}
	_ = p.attachFor(ctx, m.ChatID, tmp)
	*m = tmp[0]
}

func (p *PG) ListMessages(ctx context.Context, chatID string, q MessageQuery) ([]Message, *int64, *int64, error) {
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var maxSeq int64
	if err := p.pool.QueryRow(ctx,
		`SELECT coalesce(max(seq),0) FROM messages WHERE chat_id=$1`,
		chatID).Scan(&maxSeq); err != nil {
		return nil, nil, nil, err
	}
	var minSeq int64
	if err := p.pool.QueryRow(ctx,
		`SELECT coalesce(min(seq),0) FROM messages WHERE chat_id=$1`,
		chatID).Scan(&minSeq); err != nil {
		return nil, nil, nil, err
	}

	// the timeline keeps retracted messages as tombstones (redacted on scan);
	// search and the pinned view only ever see live messages
	base := `SELECT ` + msgCols + ` FROM messages WHERE chat_id=$1`
	live := base + ` AND deleted_at IS NULL`

	var rows pgx.Rows
	var err error
	switch {
	case q.Q != "":
		// contract: matches seq desc, `before` paginates toward older matches
		sql := live + ` AND text ILIKE '%' || $2 || '%'`
		args := []any{chatID, q.Q}
		if q.Before != nil {
			sql += ` AND seq < $3`
			args = append(args, *q.Before)
		}
		sql += ` ORDER BY seq DESC LIMIT ` + strconv.Itoa(limit)
		rows, err = p.pool.Query(ctx, sql, args...)
	case q.Pinned:
		rows, err = p.pool.Query(ctx,
			live+` AND pinned ORDER BY seq DESC LIMIT `+strconv.Itoa(limit), chatID)
	case q.AroundID != "":
		var center int64
		// contract parity with the mock: unknown id → tail window
		if e := p.pool.QueryRow(ctx,
			`SELECT seq FROM messages WHERE id=$1 AND chat_id=$2`,
			q.AroundID, chatID).Scan(&center); e != nil {
			center = maxSeq + 1 // mock parity: unknown id centers past the tail
		}
		half := limit / 2
		rows, err = p.pool.Query(ctx,
			base+` AND seq BETWEEN $2 AND $3 ORDER BY seq`,
			chatID, center-int64(half), center+int64(half))
	case q.After != nil:
		rows, err = p.pool.Query(ctx,
			base+` AND seq > $2 ORDER BY seq LIMIT `+strconv.Itoa(limit), chatID, *q.After)
	case q.Before != nil:
		rows, err = p.pool.Query(ctx,
			base+` AND seq < $2 ORDER BY seq DESC LIMIT `+strconv.Itoa(limit), chatID, *q.Before)
	default:
		rows, err = p.pool.Query(ctx,
			base+` ORDER BY seq DESC LIMIT `+strconv.Itoa(limit), chatID)
	}
	if err != nil {
		return nil, nil, nil, err
	}
	defer rows.Close()

	var msgs []Message
	for rows.Next() {
		m, err := p.scanMsg(rows)
		if err != nil {
			return nil, nil, nil, err
		}
		msgs = append(msgs, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}
	// normalize to ascending seq order (desc-ordered pages above get flipped)
	if len(msgs) > 1 && msgs[0].Seq > msgs[len(msgs)-1].Seq && q.Q == "" {
		for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
			msgs[i], msgs[j] = msgs[j], msgs[i]
		}
	}
	if err := p.attachFor(ctx, chatID, msgs); err != nil {
		return nil, nil, nil, err
	}

	var next, newer *int64
	if len(msgs) > 0 {
		if q.Q != "" {
			// older matches exist iff something seq-lower also matches
			var more bool
			_ = p.pool.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM messages WHERE chat_id=$1 AND deleted_at IS NULL
				 AND text ILIKE '%' || $2 || '%' AND seq < $3)`,
				chatID, q.Q, msgs[len(msgs)-1].Seq).Scan(&more)
			if more {
				v := msgs[len(msgs)-1].Seq
				next = &v
			}
		} else {
			if msgs[0].Seq > minSeq {
				v := msgs[0].Seq
				next = &v
			}
			if msgs[len(msgs)-1].Seq < maxSeq {
				v := msgs[len(msgs)-1].Seq
				newer = &v
			}
		}
	}
	return msgs, next, newer, nil
}

func (p *PG) SendMessage(ctx context.Context, m *Message) (*Message, bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var member bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2)`,
		m.ChatID, m.SenderID).Scan(&member); err != nil {
		return nil, false, err
	}
	if !member {
		return nil, false, ErrNotFound
	}
	if m.ReplyToMessageID != nil {
		var ok bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL)`,
			*m.ReplyToMessageID, m.ChatID).Scan(&ok); err != nil {
			return nil, false, err
		}
		if !ok {
			return nil, false, ErrNotFound
		}
	}

	var seq int64
	if err := tx.QueryRow(ctx,
		`UPDATE chats SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq`,
		m.ChatID).Scan(&seq); err != nil {
		return nil, false, err
	}

	out := &Message{ChatID: m.ChatID, SenderID: m.SenderID, Seq: seq}
	var evRaw []byte
	err = tx.QueryRow(ctx,
		`INSERT INTO messages (chat_id, sender_id, seq, text, reply_to, client_nonce)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (chat_id, sender_id, client_nonce) DO NOTHING
		 RETURNING `+msgCols,
		m.ChatID, m.SenderID, seq, m.Text, m.ReplyToMessageID, m.ClientNonce).
		Scan(&out.ID, &out.ChatID, &out.Seq, &out.SenderID, &out.Text,
			&out.ReplyToMessageID, &out.ClientNonce, &out.SentAt, &out.EditedAt,
			&out.DeletedAt, &out.Pinned, &out.Kind, &evRaw)
	if isNoRows(err) {
		// nonce replay — return the existing message; seq bump is rolled back
		_ = tx.Rollback(ctx)
		row := p.pool.QueryRow(ctx,
			`SELECT `+msgCols+` FROM messages
			 WHERE chat_id=$1 AND sender_id=$2 AND client_nonce=$3`,
			m.ChatID, m.SenderID, m.ClientNonce)
		got, err := p.scanMsg(row)
		if err != nil {
			return nil, false, err
		}
		p.attachOne(ctx, got)
		return got, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	// bind staged attachments of this sender/chat onto the new message
	if len(m.Attachments) > 0 {
		ids := make([]string, len(m.Attachments))
		for i, a := range m.Attachments {
			ids[i] = a.ID
		}
		if _, err := tx.Exec(ctx,
			`UPDATE attachments SET message_id=$1
			 WHERE id = ANY($2) AND chat_id=$3 AND uploader_id=$4 AND message_id IS NULL`,
			out.ID, ids, m.ChatID, m.SenderID); err != nil {
			return nil, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	out.setEvent(evRaw)
	p.attachOne(ctx, out)
	return out, true, nil
}

func (p *PG) MessageByID(ctx context.Context, messageID string) (*Message, error) {
	m, err := p.scanMsg(p.pool.QueryRow(ctx,
		`SELECT `+msgCols+` FROM messages WHERE id=$1`, messageID))
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.attachOne(ctx, m)
	return m, nil
}

func (p *PG) EditMessage(ctx context.Context, messageID, editorID, text string) (*Message, error) {
	m, err := p.scanMsg(p.pool.QueryRow(ctx,
		`UPDATE messages SET text=$3, edited_at=now()
		 WHERE id=$1 AND sender_id=$2 AND deleted_at IS NULL
		 RETURNING `+msgCols, messageID, editorID, text))
	if !isNoRows(err) {
		return m, err
	}
	// distinguish unknown/foreign message from "someone else's in my chat"
	var chatID string
	if e := p.pool.QueryRow(ctx,
		`SELECT chat_id FROM messages WHERE id=$1 AND deleted_at IS NULL`,
		messageID).Scan(&chatID); e != nil {
		return nil, ErrNotFound
	}
	member, err := p.IsChatMember(ctx, chatID, editorID)
	if err != nil {
		return nil, err
	}
	if !member {
		return nil, ErrNotFound // strangers get silence, not Forbidden
	}
	return nil, ErrForbidden
}

// canModerate — group delete: sender, or a member with owner /
// delete_messages rights.
func (p *PG) canDeleteMessage(ctx context.Context, msg *Message, userID string) (bool, error) {
	if msg.SenderID == userID {
		return true, nil
	}
	var ok bool
	err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM chat_members mm JOIN chats c ON c.id = mm.chat_id
		   WHERE mm.chat_id=$1 AND mm.user_id=$2 AND c.type='group'
		     AND (mm.role='owner' OR mm.rights->>'deleteMessages'='true'))`,
		msg.ChatID, userID).Scan(&ok)
	return ok, err
}

func (p *PG) DeleteMessage(ctx context.Context, messageID, userID string) error {
	msg, err := p.scanMsg(p.pool.QueryRow(ctx,
		`SELECT `+msgCols+` FROM messages WHERE id=$1 AND deleted_at IS NULL`,
		messageID))
	if isNoRows(err) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	member, err := p.IsChatMember(ctx, msg.ChatID, userID)
	if err != nil {
		return err
	}
	if !member {
		return ErrNotFound // strangers get silence, not Forbidden
	}
	ok, err := p.canDeleteMessage(ctx, msg, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrForbidden
	}
	_, err = p.pool.Exec(ctx,
		`UPDATE messages SET deleted_at=now(), text=NULL WHERE id=$1`, messageID)
	return err
}

func (p *PG) SetMessagePinned(ctx context.Context, messageID, userID string, pinned bool) (*Message, error) {
	var chatID string
	if err := p.pool.QueryRow(ctx,
		`SELECT chat_id FROM messages WHERE id=$1 AND deleted_at IS NULL`,
		messageID).Scan(&chatID); err != nil {
		return nil, ErrNotFound
	}
	// pin requires membership everywhere; in groups also pin_messages
	// (or owner)
	var allowed bool
	err := p.pool.QueryRow(ctx,
		`SELECT coalesce(mm.user_id IS NOT NULL AND
		        (c.type <> 'group' OR mm.role='owner'
		         OR mm.rights->>'pinMessages'='true'), false)
		 FROM chats c LEFT JOIN chat_members mm
		   ON mm.chat_id=c.id AND mm.user_id=$2
		 WHERE c.id=$1`, chatID, userID).Scan(&allowed)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}
	m, err := p.scanMsg(p.pool.QueryRow(ctx,
		`UPDATE messages SET pinned=$2 WHERE id=$1 AND deleted_at IS NULL
		 RETURNING `+msgCols, messageID, pinned))
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	return m, err
}

// ---- groups (party/raid rights model) ----

func (p *PG) Membership(ctx context.Context, chatID, userID string) (*GroupMember, error) {
	gm := &GroupMember{}
	var rights []byte
	err := p.pool.QueryRow(ctx,
		`SELECT u.id, u.email::text, coalesce(u.display_name,''), coalesce(u.tag,''),
		        u.avatar_url, u.created_at, cm.role, cm.rights, cm.joined_at
		 FROM chat_members cm JOIN users u ON u.id = cm.user_id
		 WHERE cm.chat_id=$1 AND cm.user_id=$2`, chatID, userID).
		Scan(&gm.User.ID, &gm.User.Email, &gm.User.DisplayName, &gm.User.Tag,
			&gm.User.AvatarURL, &gm.User.CreatedAt, &gm.Role, &rights, &gm.JoinedAt)
	if isNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(rights, &gm.Rights)
	return gm, nil
}

// allMutual — every id must be a mutual contact of the actor (consent
// gate: a one-way edge no longer exists, but mutuality is re-checked
// structurally so the gate survives any future data drift).
func (p *PG) allMutual(ctx context.Context, actorID string, ids []string) (bool, error) {
	for _, id := range ids {
		if id == actorID {
			continue
		}
		ok, err := p.AreMutual(ctx, actorID, id)
		if err != nil || !ok {
			return false, err
		}
	}
	return true, nil
}

func (p *PG) CreateGroup(ctx context.Context, ownerID, title string, memberIDs []string) (*Chat, error) {
	ok, err := p.allMutual(ctx, ownerID, memberIDs)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrForbidden
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var chatID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO chats (type, title) VALUES ('group', $1) RETURNING id`,
		title).Scan(&chatID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'owner')`,
		chatID, ownerID); err != nil {
		return nil, err
	}
	for _, id := range memberIDs {
		if id == ownerID {
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO group_invites (chat_id, invitee_id, inviter_id) VALUES ($1,$2,$3)
			 ON CONFLICT DO NOTHING`, chatID, id, ownerID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return p.ChatByID(ctx, chatID, ownerID)
}

// groupActor — actor must sit in a *group* chat. Missing chat, non-group
// chat, and non-member actor all collapse to ErrNotFound: group routes
// never reveal which of the three happened (existence privacy).
func (p *PG) groupActor(ctx context.Context, chatID, actorID string) (string, MemberRights, error) {
	var typ, role string
	var raw []byte
	err := p.pool.QueryRow(ctx,
		`SELECT c.type, coalesce(mm.role,''), coalesce(mm.rights,'{}'::jsonb)
		 FROM chats c LEFT JOIN chat_members mm
		   ON mm.chat_id=c.id AND mm.user_id=$2
		 WHERE c.id=$1`, chatID, actorID).Scan(&typ, &role, &raw)
	if isNoRows(err) || err == nil && (typ != "group" || role == "") {
		return "", MemberRights{}, ErrNotFound
	}
	if err != nil {
		return "", MemberRights{}, err
	}
	var rights MemberRights
	_ = json.Unmarshal(raw, &rights)
	return role, rights, nil
}

func rightSet(r MemberRights, name string) bool {
	switch name {
	case "inviteMembers":
		return r.InviteMembers
	case "removeMembers":
		return r.RemoveMembers
	case "editInfo":
		return r.EditInfo
	case "pinMessages":
		return r.PinMessages
	case "deleteMessages":
		return r.DeleteMessages
	}
	return false
}

// memberGate — actor must be a group member with the given right
// (owner always passes). Returns ErrNotFound for foreign chats.
func (p *PG) memberGate(ctx context.Context, chatID, actorID, right string) error {
	role, rights, err := p.groupActor(ctx, chatID, actorID)
	if err != nil {
		return err
	}
	if role != "owner" && !rightSet(rights, right) {
		return ErrForbidden
	}
	return nil
}

func (p *PG) SetGroupTitle(ctx context.Context, chatID, actorID, title string) (*Chat, error) {
	if err := p.memberGate(ctx, chatID, actorID, "editInfo"); err != nil {
		return nil, err
	}
	tag, err := p.pool.Exec(ctx,
		`UPDATE chats SET title=$2 WHERE id=$1 AND type='group'`, chatID, title)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return p.ChatByID(ctx, chatID, actorID)
}

func (p *PG) AddGroupMembers(ctx context.Context, chatID, actorID string, memberIDs []string) ([]string, error) {
	if err := p.memberGate(ctx, chatID, actorID, "inviteMembers"); err != nil {
		return nil, err
	}
	// members and already-invited users (pending or silently declined) are
	// idempotent no-ops — filtered before the mutual gate so a re-add can't
	// 403 and a decline can't be probed by re-inviting
	rows, err := p.pool.Query(ctx,
		`SELECT user_id FROM chat_members WHERE chat_id=$1 AND user_id=ANY($2)
		 UNION SELECT invitee_id FROM group_invites WHERE chat_id=$1 AND invitee_id=ANY($2)`,
		chatID, memberIDs)
	if err != nil {
		return nil, err
	}
	skip := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		skip[id] = true
	}
	rows.Close()
	var fresh []string
	seen := map[string]bool{}
	for _, id := range memberIDs {
		if !skip[id] && !seen[id] {
			seen[id] = true
			fresh = append(fresh, id)
		}
	}
	ok, err := p.allMutual(ctx, actorID, fresh)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrForbidden
	}
	for _, id := range fresh {
		if _, err := p.pool.Exec(ctx,
			`INSERT INTO group_invites (chat_id, invitee_id, inviter_id) VALUES ($1,$2,$3)
			 ON CONFLICT DO NOTHING`, chatID, id, actorID); err != nil {
			return nil, err
		}
	}
	return fresh, nil
}

func (p *PG) RemoveGroupMember(ctx context.Context, chatID, actorID, targetID string) error {
	// actor gate first — a stranger must not learn anything about the
	// target (membership, ownership) from the status code
	role, rights, err := p.groupActor(ctx, chatID, actorID)
	if err != nil {
		return err
	}
	tm, err := p.Membership(ctx, chatID, targetID)
	if err != nil {
		return err // ErrNotFound — not a member
	}
	if tm.Role == "owner" {
		return ErrForbidden // owner leaves only via TransferOwnership
	}
	if actorID != targetID && role != "owner" && !rights.RemoveMembers {
		return ErrForbidden
	}
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, targetID); err != nil {
		return err
	}
	return nil
}

func (p *PG) SetMemberRights(ctx context.Context, chatID, ownerID, targetID string, rights MemberRights) (*GroupMember, error) {
	role, _, err := p.groupActor(ctx, chatID, ownerID)
	if err != nil {
		return nil, err
	}
	if role != "owner" || targetID == ownerID {
		return nil, ErrForbidden // owner only; owner can't edit own rights
	}
	tm, err := p.Membership(ctx, chatID, targetID)
	if err != nil {
		return nil, err
	}
	if tm.Role == "owner" {
		return nil, ErrForbidden
	}
	raw, err := json.Marshal(rights)
	if err != nil {
		return nil, err
	}
	if _, err := p.pool.Exec(ctx,
		`UPDATE chat_members SET rights=$3 WHERE chat_id=$1 AND user_id=$2`,
		chatID, targetID, raw); err != nil {
		return nil, err
	}
	return p.Membership(ctx, chatID, targetID)
}

func (p *PG) TransferOwnership(ctx context.Context, chatID, ownerID, newOwnerID string) error {
	role, _, err := p.groupActor(ctx, chatID, ownerID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return ErrForbidden
	}
	if _, err := p.Membership(ctx, chatID, newOwnerID); err != nil {
		return err // target must already sit in the group
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`UPDATE chat_members SET role='member' WHERE chat_id=$1 AND user_id=$2`,
		chatID, ownerID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE chat_members SET role='owner' WHERE chat_id=$1 AND user_id=$2`,
		chatID, newOwnerID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *PG) MarkRead(ctx context.Context, chatID, userID string, upToSeq int64) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE chat_members SET last_read_seq = greatest(last_read_seq,
		   least($3, (SELECT last_seq FROM chats WHERE id=$1)))
		 WHERE chat_id=$1 AND user_id=$2`, chatID, userID, upToSeq)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (p *PG) CreateAttachment(ctx context.Context, a *Attachment) (*Attachment, error) {
	row := p.pool.QueryRow(ctx,
		`INSERT INTO attachments (chat_id, uploader_id, kind, mime_type, file_name, size_bytes, storage_path)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id, created_at`,
		a.ChatID, a.UploaderID, a.Kind, a.MimeType, a.FileName, a.SizeBytes, a.StoragePath)
	out := *a
	if err := row.Scan(&out.ID, &out.CreatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (p *PG) AttachmentByID(ctx context.Context, id string) (*Attachment, error) {
	var a Attachment
	err := p.pool.QueryRow(ctx,
		`SELECT a.id, a.chat_id, a.uploader_id, a.kind, a.mime_type, coalesce(a.file_name,''),
		        a.size_bytes, coalesce(a.storage_path,''), a.created_at,
		        coalesce(a.message_id::text,'')
		 FROM attachments a WHERE a.id=$1
		   AND NOT EXISTS (SELECT 1 FROM messages m
		                   WHERE m.id = a.message_id AND m.deleted_at IS NOT NULL)`, id).
		Scan(&a.ID, &a.ChatID, &a.UploaderID, &a.Kind, &a.MimeType,
			&a.FileName, &a.SizeBytes, &a.StoragePath, &a.CreatedAt,
			&a.MessageID)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}
