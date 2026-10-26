// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store

import (
	"context"
	"sort"
	"time"
)

// In-memory twin of pg_contacts.go — identical semantics (the parity
// suite in pg_test.go / mem_test.go runs the same assertions on both).

type memReq struct {
	status    string // pending|declined (declined is silent)
	createdAt time.Time
}

type memInvite struct {
	inviter   string
	status    string
	createdAt time.Time
}

// mutual — caller holds cs.mu.
func (cs *memChats) mutual(a, b string) bool {
	_, ab := cs.contacts[a][b]
	_, ba := cs.contacts[b][a]
	return ab && ba
}

func (cs *memChats) link(a, b string, at time.Time) {
	for _, p := range [][2]string{{a, b}, {b, a}} {
		if cs.contacts[p[0]] == nil {
			cs.contacts[p[0]] = map[string]time.Time{}
		}
		if _, ok := cs.contacts[p[0]][p[1]]; !ok {
			cs.contacts[p[0]][p[1]] = at
		}
	}
}

func (m *Mem) user(id string) (User, bool) {
	u, err := m.UserByID(context.Background(), id)
	if err != nil {
		return User{}, false
	}
	return *u, true
}

func (m *Mem) ListContacts(_ context.Context, userID string) ([]Contact, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var out []Contact
	for cid, at := range cs.contacts[userID] {
		if u, ok := m.user(cid); ok {
			out = append(out, Contact{User: u, Mutual: true, AddedAt: at})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AddedAt.Before(out[j].AddedAt) })
	return out, nil
}

func (m *Mem) RequestContact(_ context.Context, from, to string) (*ContactRequestResult, error) {
	if from == to {
		return nil, ErrInvalid
	}
	target, ok := m.user(to)
	if !ok {
		return nil, ErrNotFound
	}
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if cs.mutual(from, to) {
		return nil, ErrConflict
	}
	if _, asked := cs.requests[to][from]; asked { // target already asked us
		delete(cs.requests[to], from)
		now := time.Now()
		cs.link(from, to, now)
		return &ContactRequestResult{Mutual: true, Contact: &Contact{User: target, Mutual: true, AddedAt: now}}, nil
	}
	if r, dup := cs.requests[from][to]; dup { // pending or silently declined
		return &ContactRequestResult{Existing: true, Request: &ContactRequest{User: target, CreatedAt: r.createdAt}}, nil
	}
	if cs.requests[from] == nil {
		cs.requests[from] = map[string]*memReq{}
	}
	now := time.Now()
	cs.requests[from][to] = &memReq{status: "pending", createdAt: now}
	return &ContactRequestResult{Request: &ContactRequest{User: target, CreatedAt: now}}, nil
}

func (m *Mem) ListContactRequests(_ context.Context, userID string) ([]ContactRequest, []ContactRequest, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var in, out []ContactRequest
	for requester, targets := range cs.requests {
		if r, ok := targets[userID]; ok && r.status == "pending" {
			if u, ok := m.user(requester); ok {
				in = append(in, ContactRequest{User: u, CreatedAt: r.createdAt})
			}
		}
	}
	for target, r := range cs.requests[userID] {
		if u, ok := m.user(target); ok {
			out = append(out, ContactRequest{User: u, CreatedAt: r.createdAt})
		}
	}
	newest := func(s []ContactRequest) {
		sort.Slice(s, func(i, j int) bool { return s[i].CreatedAt.After(s[j].CreatedAt) })
	}
	newest(in)
	newest(out)
	return in, out, nil
}

func (m *Mem) AcceptContactRequest(_ context.Context, me, requesterID string) (*Contact, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	r, ok := cs.requests[requesterID][me]
	if !ok || r.status != "pending" {
		return nil, ErrNotFound
	}
	u, ok := m.user(requesterID)
	if !ok {
		return nil, ErrNotFound
	}
	delete(cs.requests[requesterID], me)
	now := time.Now()
	cs.link(me, requesterID, now)
	return &Contact{User: u, Mutual: true, AddedAt: cs.contacts[me][requesterID]}, nil
}

func (m *Mem) DeclineContactRequest(_ context.Context, me, requesterID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	r, ok := cs.requests[requesterID][me]
	if !ok || r.status != "pending" {
		return ErrNotFound
	}
	r.status = "declined"
	return nil
}

func (m *Mem) CancelContactRequest(_ context.Context, me, targetID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if _, ok := cs.requests[me][targetID]; !ok {
		return ErrNotFound
	}
	delete(cs.requests[me], targetID)
	return nil
}

func (m *Mem) RemoveContact(_ context.Context, userID, contactID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	_, a := cs.contacts[userID][contactID]
	_, b := cs.contacts[contactID][userID]
	if !a && !b {
		return ErrNotFound
	}
	delete(cs.contacts[userID], contactID)
	delete(cs.contacts[contactID], userID)
	return nil
}

func (m *Mem) AreMutual(_ context.Context, a, b string) (bool, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	return cs.mutual(a, b), nil
}

func (m *Mem) Relationship(_ context.Context, a, b string) (string, error) {
	if a == b {
		return "self", nil
	}
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	switch {
	case cs.mutual(a, b):
		return "contact_mutual", nil
	case cs.requests[a][b] != nil:
		return "contact_outgoing", nil
	case cs.requests[b][a] != nil && cs.requests[b][a].status == "pending":
		return "contact_incoming", nil
	}
	return "none", nil
}

func (m *Mem) MutualContactIDs(_ context.Context, userID string) ([]string, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var out []string
	for cid := range cs.contacts[userID] {
		out = append(out, cid)
	}
	return out, nil
}

func (m *Mem) ListGroupInvites(_ context.Context, userID string) ([]GroupInvite, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	var out []GroupInvite
	for chatID, byUser := range cs.invites {
		inv, ok := byUser[userID]
		if !ok || inv.status != "pending" {
			continue
		}
		c := cs.chats[chatID]
		inviter, ok := m.user(inv.inviter)
		if c == nil || !ok {
			continue
		}
		title := ""
		if c.Title != nil {
			title = *c.Title
		}
		out = append(out, GroupInvite{ChatID: chatID, Title: title,
			MemberCount: len(cs.members[chatID]), Inviter: inviter, CreatedAt: inv.createdAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (m *Mem) AcceptGroupInvite(_ context.Context, chatID, userID string) (*Chat, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	inv, ok := cs.invites[chatID][userID]
	if !ok || inv.status != "pending" {
		return nil, ErrNotFound
	}
	delete(cs.invites[chatID], userID)
	cs.members[chatID][userID] = &memMember{GroupMember: GroupMember{
		User: User{ID: userID}, Role: "member", JoinedAt: time.Now()}}
	return m.chatView(cs, cs.chats[chatID], userID), nil
}

func (m *Mem) DeclineGroupInvite(_ context.Context, chatID, userID string) error {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	inv, ok := cs.invites[chatID][userID]
	if !ok || inv.status != "pending" {
		return ErrNotFound
	}
	inv.status = "declined"
	return nil
}

func (m *Mem) AddSystemMessage(_ context.Context, chatID, actorID string, ev SystemEvent) (*Message, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	c, ok := cs.chats[chatID]
	if !ok {
		return nil, ErrNotFound
	}
	c.lastSeq++
	evc := ev
	msg := &Message{
		ID: memID(), ChatID: chatID, Seq: c.lastSeq, SenderID: actorID,
		ClientNonce: "sys-" + memID(), SentAt: time.Now(), Kind: "system", SystemEvent: &evc,
	}
	cs.messages[chatID] = append(cs.messages[chatID], msg)
	out := *msg
	return &out, nil
}

func (m *Mem) DirectChatBetween(_ context.Context, a, b string) (string, bool, error) {
	cs := m.cs()
	cs.mu.Lock()
	defer cs.mu.Unlock()
	key := directKey(a, b)
	for id, c := range cs.chats {
		if c.directKey == key {
			return id, true, nil
		}
	}
	return "", false, nil
}
