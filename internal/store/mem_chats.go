// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

// Mem chat state — same Mem serves AuthStore and ChatStore.

type memChat struct {
	Chat
	directKey string
	lastSeq   int64
}

type memMember struct {
	GroupMember
	lastReadSeq int64
	pinned      bool
}

// chatStore fields are kept on a separate struct embedded into Mem via
// lazy init — keeps mem.go untouched for existing tests.
type memChats struct {
	mu       sync.Mutex
	chats    map[string]*memChat
	members  map[string]map[string]*memMember // chatID -> userID -> member
	messages map[string][]*Message            // chatID -> seq-ordered
	contacts map[string]map[string]time.Time  // owner -> contact -> addedAt
	nonce    map[string]*Message              // chatID:senderID:nonce
}

func (m *Mem) cs() *memChats {
	m.chatOnce.Do(func() {
		m.chats = &memChats{
			chats:    map[string]*memChat{},
			members:  map[string]map[string]*memMember{},
			messages: map[string][]*Message{},
			contacts: map[string]map[string]time.Time{},
			nonce:    map[string]*Message{},
		}
	})
	return m.chats
}

func directKey(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return a + ":" + b
}

func (m *Mem) ListContacts(_ context.Context, userID string) ([]Contact, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var out []Contact
	for cid, at := range cs.contacts[userID] {
		u, err := m.UserByID(context.Background(), cid)
		if err != nil {
			continue
		}
		_, mutual := cs.contacts[cid][userID]
		out = append(out, Contact{User: *u, Mutual: mutual, AddedAt: at})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AddedAt.Before(out[j].AddedAt) })
	return out, nil
}

func (m *Mem) AddContact(_ context.Context, userID, contactID string) (*Contact, error) {
	if _, err := m.UserByID(context.Background(), contactID); err != nil {
		return nil, err
	}
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if cs.contacts[userID] == nil {
		cs.contacts[userID] = map[string]time.Time{}
	}
	if _, dup := cs.contacts[userID][contactID]; dup {
		return nil, ErrConflict
	}
	at := time.Now()
	cs.contacts[userID][contactID] = at
	u, _ := m.UserByID(context.Background(), contactID)
	_, mutual := cs.contacts[contactID][userID]
	return &Contact{User: *u, Mutual: mutual, AddedAt: at}, nil
}

func (m *Mem) RemoveContact(_ context.Context, userID, contactID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if _, ok := cs.contacts[userID][contactID]; !ok {
		return ErrNotFound
	}
	delete(cs.contacts[userID], contactID)
	return nil
}

func (m *Mem) AreMutual(_ context.Context, a, b string) (bool, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	_, ab := cs.contacts[a][b]
	_, ba := cs.contacts[b][a]
	return ab && ba, nil
}

func (m *Mem) ContactEdges(_ context.Context, a, b string) (bool, bool, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	_, ab := cs.contacts[a][b]
	_, ba := cs.contacts[b][a]
	return ab, ba, nil
}

func (m *Mem) IsChatMember(_ context.Context, chatID, userID string) (bool, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	_, ok := cs.members[chatID][userID]
	return ok, nil
}

func (m *Mem) MutualContactIDs(_ context.Context, userID string) ([]string, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var out []string
	for cid := range cs.contacts[userID] {
		if _, back := cs.contacts[cid][userID]; back {
			out = append(out, cid)
		}
	}
	return out, nil
}

func (m *Mem) ChatMemberIDs(_ context.Context, chatID string) ([]string, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	out := make([]string, 0, len(cs.members[chatID]))
	for uid := range cs.members[chatID] {
		out = append(out, uid)
	}
	return out, nil
}

// summary builds a member-view ChatSummary — the ordering for List.
func (m *Mem) summary(cs *memChats, c *memChat, userID string) ChatSummary {
	mm := cs.members[c.ID][userID]
	s := ChatSummary{
		Chat:           c.Chat,
		LastActivityAt: c.CreatedAt,
		MemberCount:    len(cs.members[c.ID]),
		Pinned:         mm.pinned,
	}
	msgs := cs.messages[c.ID]
	if n := len(msgs); n > 0 {
		for i := n - 1; i >= 0; i-- {
			if msgs[i].DeletedAt == nil {
				lm := *msgs[i]
				s.LastMessage = &lm
				s.LastActivityAt = lm.SentAt
				break
			}
		}
		for _, msg := range msgs {
			if msg.DeletedAt == nil && msg.Seq > mm.lastReadSeq && msg.SenderID != userID {
				s.UnreadCount++
			}
		}
	}
	return s
}

func (m *Mem) ListChatSummaries(_ context.Context, userID string) ([]ChatSummary, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var out []ChatSummary
	for chatID, mems := range cs.members {
		if _, ok := mems[userID]; !ok {
			continue
		}
		out = append(out, m.summary(cs, cs.chats[chatID], userID))
	}
	// contract order: pinned first, then lastActivityAt desc
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].LastActivityAt.After(out[j].LastActivityAt)
	})
	return out, nil
}

// chatView resolves peer (direct) / members (group) for the member-view Chat.
func (m *Mem) chatView(cs *memChats, c *memChat, userID string) *Chat {
	view := c.Chat
	if c.Type == "direct" {
		for uid := range cs.members[c.ID] {
			if uid != userID || len(cs.members[c.ID]) == 1 {
				u, err := m.UserByID(context.Background(), uid)
				if err == nil {
					cp := *u
					view.Peer = &cp
				}
				break
			}
		}
	} else {
		for _, mm := range cs.members[c.ID] {
			u, err := m.UserByID(context.Background(), mm.User.ID)
			if err == nil {
				gm := mm.GroupMember
				gm.User = *u
				view.Members = append(view.Members, gm)
			}
		}
	}
	return &view
}

func (m *Mem) ChatByID(_ context.Context, chatID, userID string) (*Chat, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if _, ok := cs.members[chatID][userID]; !ok {
		return nil, ErrNotFound
	}
	return m.chatView(cs, cs.chats[chatID], userID), nil
}

func (m *Mem) OpenDirectChat(_ context.Context, me, peerID string) (*Chat, bool, error) {
	peer, err := m.UserByID(context.Background(), peerID)
	if err != nil {
		return nil, false, err
	}
	self := me == peerID
	if !self {
		mutual, err := m.AreMutual(context.Background(), me, peerID)
		if err != nil {
			return nil, false, err
		}
		if !mutual {
			return nil, false, ErrForbidden
		}
	}
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	key := directKey(me, peerID)
	for _, c := range cs.chats {
		if c.directKey == key {
			return m.chatView(cs, c, me), false, nil
		}
	}
	c := &memChat{
		Chat:      Chat{ID: memID(), Type: "direct", CreatedAt: time.Now()},
		directKey: key,
	}
	cs.chats[c.ID] = c
	cs.members[c.ID] = map[string]*memMember{}
	for _, uid := range []string{me, peerID} {
		cs.members[c.ID][uid] = &memMember{GroupMember: GroupMember{
			User: User{ID: uid}, Role: "member", JoinedAt: time.Now(),
		}}
	}
	if self { // self-chat has a single member row; peer resolution yields self
		view := c.Chat
		cp := *peer
		view.Peer = &cp
		return &view, true, nil
	}
	return m.chatView(cs, c, me), true, nil
}

func (m *Mem) SetChatPinned(_ context.Context, chatID, userID string, pinned bool) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	mm, ok := cs.members[chatID][userID]
	if !ok {
		return ErrNotFound
	}
	mm.pinned = pinned
	return nil
}

func (m *Mem) ListMessages(_ context.Context, chatID string, q MessageQuery) ([]Message, *int64, *int64, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	msgs := cs.messages[chatID]
	var list []*Message
	for _, msg := range msgs {
		if msg.DeletedAt == nil {
			list = append(list, msg)
		}
	}
	if q.Pinned {
		var p []*Message
		for _, msg := range list {
			if msg.Pinned {
				p = append(p, msg)
			}
		}
		list = p
	}
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	if q.Q != "" {
		lq := strings.ToLower(q.Q)
		var matches []*Message
		for i := len(list) - 1; i >= 0; i-- { // seq desc
			if list[i].Text != nil && strings.Contains(strings.ToLower(*list[i].Text), lq) {
				matches = append(matches, list[i])
			}
		}
		if q.Before != nil {
			var older []*Message
			for _, msg := range matches {
				if msg.Seq < *q.Before {
					older = append(older, msg)
				}
			}
			matches = older
		}
		page := matches
		if len(page) > limit {
			page = page[:limit]
		}
		var next *int64
		if len(matches) > len(page) && len(page) > 0 {
			v := page[len(page)-1].Seq
			next = &v
		}
		return cloneMsgs(page), next, nil, nil
	}

	var page []*Message
	switch {
	case q.AroundID != "":
		center := len(list) // missing id → tail window (mock parity)
		for i, msg := range list {
			if msg.ID == q.AroundID {
				center = i
				break
			}
		}
		half := limit / 2
		lo := center - half
		if lo < 0 {
			lo = 0
		}
		hi := center + half + 1
		if hi > len(list) {
			hi = len(list)
		}
		page = list[lo:hi]
	case q.After != nil:
		for _, msg := range list {
			if msg.Seq > *q.After {
				page = append(page, msg)
			}
		}
		if len(page) > limit {
			page = page[:limit]
		}
	case q.Before != nil:
		for _, msg := range list {
			if msg.Seq < *q.Before {
				page = append(page, msg)
			}
		}
		if len(page) > limit {
			page = page[len(page)-limit:]
		}
	default:
		page = list
		if len(page) > limit {
			page = page[len(page)-limit:]
		}
	}

	var next, newer *int64
	if len(page) > 0 && len(list) > 0 {
		if list[0].Seq < page[0].Seq {
			v := page[0].Seq
			next = &v
		}
		if list[len(list)-1].Seq > page[len(page)-1].Seq {
			v := page[len(page)-1].Seq
			newer = &v
		}
	}
	return cloneMsgs(page), next, newer, nil
}

func cloneMsgs(in []*Message) []Message {
	out := make([]Message, len(in))
	for i, m := range in {
		out[i] = *m
		out[i].Attachments = append([]Attachment(nil), m.Attachments...)
	}
	return out
}

func (m *Mem) SendMessage(_ context.Context, msg *Message) (*Message, bool, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[msg.ChatID]
	if !ok {
		return nil, false, ErrNotFound
	}
	if _, member := cs.members[msg.ChatID][msg.SenderID]; !member {
		return nil, false, ErrNotFound
	}
	key := msg.ChatID + ":" + msg.SenderID + ":" + msg.ClientNonce
	if dup, ok := cs.nonce[key]; ok {
		cp := *dup
		return &cp, false, nil
	}
	if msg.ReplyToMessageID != nil {
		found := false
		for _, ex := range cs.messages[msg.ChatID] {
			if ex.ID == *msg.ReplyToMessageID && ex.DeletedAt == nil {
				found = true
				break
			}
		}
		if !found {
			return nil, false, ErrNotFound
		}
	}
	c.lastSeq++
	cp := *msg
	cp.ID = memID()
	cp.Seq = c.lastSeq
	cp.SentAt = time.Now()
	cs.messages[msg.ChatID] = append(cs.messages[msg.ChatID], &cp)
	cs.nonce[key] = &cp
	out := cp
	return &out, true, nil
}

func (m *Mem) MessageByID(_ context.Context, messageID string) (*Message, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for _, msgs := range cs.messages {
		for _, msg := range msgs {
			if msg.ID == messageID {
				cp := *msg
				return &cp, nil
			}
		}
	}
	return nil, ErrNotFound
}

func (m *Mem) EditMessage(_ context.Context, messageID, editorID, text string) (*Message, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for _, msgs := range cs.messages {
		for _, msg := range msgs {
			if msg.ID == messageID {
				if msg.DeletedAt != nil || cs.members[msg.ChatID][editorID] == nil {
					return nil, ErrNotFound // tombstones and strangers → silence
				}
				if msg.SenderID != editorID {
					return nil, ErrForbidden
				}
				msg.Text = &text
				now := time.Now()
				msg.EditedAt = &now
				cp := *msg
				return &cp, nil
			}
		}
	}
	return nil, ErrNotFound
}

func (m *Mem) DeleteMessage(_ context.Context, messageID, userID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for _, msgs := range cs.messages {
		for _, msg := range msgs {
			if msg.ID == messageID {
				if msg.DeletedAt != nil {
					return ErrNotFound // tombstones are gone (PG parity)
				}
				mm := cs.members[msg.ChatID][userID]
				if mm == nil {
					return ErrNotFound // strangers get silence, not Forbidden
				}
				if msg.SenderID == userID {
					now := time.Now()
					msg.DeletedAt = &now
					return nil
				}
				// groups: owner or delete_messages may remove others' posts
				if cs.chats[msg.ChatID].Type == "group" &&
					(mm.Role == "owner" || mm.Rights.DeleteMessages) {
					now := time.Now()
					msg.DeletedAt = &now
					return nil
				}
				return ErrForbidden
			}
		}
	}
	return ErrNotFound
}

func (m *Mem) SetMessagePinned(_ context.Context, messageID, userID string, pinned bool) (*Message, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for _, msgs := range cs.messages {
		for _, msg := range msgs {
			if msg.ID == messageID {
				if msg.DeletedAt != nil {
					return nil, ErrNotFound // no pinning tombstones (PG parity)
				}
				mm := cs.members[msg.ChatID][userID]
				if mm == nil {
					return nil, ErrForbidden
				}
				// groups: pin requires pin_messages or owner
				if cs.chats[msg.ChatID].Type == "group" &&
					mm.Role != "owner" && !mm.Rights.PinMessages {
					return nil, ErrForbidden
				}
				msg.Pinned = pinned
				cp := *msg
				return &cp, nil
			}
		}
	}
	return nil, ErrNotFound
}

// ---- groups (party/raid rights model) ----

func (m *Mem) Membership(_ context.Context, chatID, userID string) (*GroupMember, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	mm, ok := cs.members[chatID][userID]
	if !ok {
		return nil, ErrNotFound
	}
	gm := mm.GroupMember
	if u, err := m.UserByID(context.Background(), userID); err == nil {
		gm.User = *u
	}
	return &gm, nil
}

// isContact — group invites are restricted to the actor's contact list
// (outgoing edge; mutual not required) — anti-spam decision.
func isContact(cs *memChats, owner, contact string) bool {
	_, ok := cs.contacts[owner][contact]
	return ok
}

func (m *Mem) CreateGroup(_ context.Context, ownerID, title string, memberIDs []string) (*Chat, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for _, id := range memberIDs {
		if id == ownerID {
			continue
		}
		if _, err := m.UserByID(context.Background(), id); err != nil || !isContact(cs, ownerID, id) {
			return nil, ErrForbidden
		}
	}
	now := time.Now()
	c := &memChat{Chat: Chat{ID: memID(), Type: "group", Title: &title, CreatedAt: now}}
	cs.chats[c.ID] = c
	cs.members[c.ID] = map[string]*memMember{}
	cs.members[c.ID][ownerID] = &memMember{GroupMember: GroupMember{
		User: User{ID: ownerID}, Role: "owner", JoinedAt: now}}
	for _, id := range memberIDs {
		if id == ownerID {
			continue
		}
		cs.members[c.ID][id] = &memMember{GroupMember: GroupMember{
			User: User{ID: id}, Role: "member", JoinedAt: now}}
	}
	return m.chatView(cs, c, ownerID), nil
}

func (m *Mem) SetGroupTitle(_ context.Context, chatID, actorID, title string) (*Chat, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	mm := cs.members[chatID][actorID]
	if !ok || mm == nil || c.Type != "group" {
		return nil, ErrNotFound
	}
	if mm.Role != "owner" && !mm.Rights.EditInfo {
		return nil, ErrForbidden
	}
	c.Title = &title
	return m.chatView(cs, c, actorID), nil
}

func (m *Mem) AddGroupMembers(_ context.Context, chatID, actorID string, memberIDs []string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	mm := cs.members[chatID][actorID]
	if !ok || mm == nil || c.Type != "group" {
		return ErrNotFound
	}
	if mm.Role != "owner" && !mm.Rights.InviteMembers {
		return ErrForbidden
	}
	// validate everything before mutating — a mid-loop rejection must
	// not leave a partially-applied roster
	var fresh []string
	for _, id := range memberIDs {
		if _, member := cs.members[chatID][id]; member {
			continue // idempotent re-add
		}
		if _, err := m.UserByID(context.Background(), id); err != nil {
			return ErrForbidden
		}
		if !isContact(cs, actorID, id) {
			return ErrForbidden // contacts-only invites
		}
		fresh = append(fresh, id)
	}
	for _, id := range fresh {
		cs.members[chatID][id] = &memMember{GroupMember: GroupMember{
			User: User{ID: id}, Role: "member", JoinedAt: time.Now()}}
	}
	return nil
}

func (m *Mem) RemoveGroupMember(_ context.Context, chatID, actorID, targetID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	mm := cs.members[chatID][actorID]
	tm := cs.members[chatID][targetID]
	if !ok || mm == nil || tm == nil || c.Type != "group" {
		return ErrNotFound
	}
	if tm.Role == "owner" {
		return ErrForbidden // owner leaves only via transferOwnership
	}
	if actorID != targetID && mm.Role != "owner" && !mm.Rights.RemoveMembers {
		return ErrForbidden
	}
	delete(cs.members[chatID], targetID)
	return nil
}

func (m *Mem) SetMemberRights(_ context.Context, chatID, ownerID, targetID string, rights MemberRights) (*GroupMember, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	mm := cs.members[chatID][ownerID]
	tm := cs.members[chatID][targetID]
	if mm == nil || tm == nil || cs.chats[chatID].Type != "group" {
		return nil, ErrNotFound
	}
	if mm.Role != "owner" || targetID == ownerID {
		return nil, ErrForbidden // owner only; owner can't edit own rights
	}
	tm.Rights = rights
	gm := tm.GroupMember
	if u, err := m.UserByID(context.Background(), targetID); err == nil {
		gm.User = *u
	}
	return &gm, nil
}

func (m *Mem) TransferOwnership(_ context.Context, chatID, ownerID, newOwnerID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	mm := cs.members[chatID][ownerID]
	tm := cs.members[chatID][newOwnerID]
	if mm == nil || tm == nil || cs.chats[chatID].Type != "group" {
		return ErrNotFound
	}
	if mm.Role != "owner" {
		return ErrForbidden
	}
	mm.Role, tm.Role = "member", "owner"
	return nil
}

func (m *Mem) MarkRead(_ context.Context, chatID, userID string, upToSeq int64) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	mm, ok := cs.members[chatID][userID]
	if !ok {
		return ErrNotFound
	}
	if max := cs.chats[chatID].lastSeq; upToSeq > max {
		upToSeq = max
	}
	if upToSeq > mm.lastReadSeq {
		mm.lastReadSeq = upToSeq
	}
	return nil
}
