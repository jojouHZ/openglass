// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// PG integration test — runs only when a real database is present:
//
//	docker compose up -d postgres
//	OPENGLASS_TEST_PG_DSN=postgres://openglass:openglass_dev@localhost:5432/openglass go test ./internal/store
package store_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jojouHZ/openglass/internal/store"
)

func pgOrSkip(t *testing.T) *store.PG {
	t.Helper()
	dsn := os.Getenv("OPENGLASS_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("OPENGLASS_TEST_PG_DSN unset — no live postgres")
	}
	ctx := context.Background()
	pg, err := store.NewPG(ctx, dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := store.Migrate(ctx, pg.Pool()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(pg.Close)
	return pg
}

func TestPG_AuthRoundtrip(t *testing.T) {
	pg := pgOrSkip(t)
	ctx := context.Background()

	sfx := store_testID(t)
	email := "pgtest-" + sfx + "@x.io"
	u, err := pg.CreateUser(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	if u.ID == "" {
		t.Fatal("no id")
	}

	byMail, err := pg.UserByEmail(ctx, email)
	if err != nil || byMail.ID != u.ID {
		t.Fatalf("byEmail: %v", err)
	}

	tag := "pgt" + sfx + "#0001"
	done, err := pg.CompleteProfile(ctx, u.ID, "Pg Test", tag)
	if err != nil || done.Tag != tag {
		t.Fatalf("profile: %v", err)
	}
	exists, _ := pg.TagExists(ctx, tag)
	if !exists {
		t.Fatal("tag not visible")
	}
	// same-user re-complete with own tag is idempotent, not a conflict
	if _, err := pg.CompleteProfile(ctx, u.ID, "X", tag); err != nil {
		t.Fatalf("own-tag re-complete should succeed: %v", err)
	}
	// but a different user cannot take the tag
	u2, err := pg.CreateUser(ctx, "pgtest2-"+sfx+"@x.io")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pg.CompleteProfile(ctx, u2.ID, "Other", tag); err != store.ErrConflict {
		t.Fatalf("expected ErrConflict on duplicate tag, got %v", err)
	}

	// per-run hashes — the dev DB is persistent across test runs
	h1 := []byte("h1-" + sfx)
	h9 := []byte("h9-" + sfx)
	sess, err := pg.CreateSession(ctx, u.ID, "pg-test", h1)
	if err != nil {
		t.Fatal(err)
	}
	got, revoked, err := pg.SessionByRefreshHash(ctx, h1)
	if err != nil || revoked || got.ID != sess.ID {
		t.Fatalf("session lookup: %v", err)
	}
	if err := pg.RotateSessionRefresh(ctx, sess.ID, h9); err != nil {
		t.Fatal(err)
	}
	if _, revoked, _ := pg.SessionByRefreshHash(ctx, h9); revoked {
		t.Fatal("rotated session wrongly revoked")
	}
	if err := pg.RevokeSession(ctx, sess.ID); err != nil {
		t.Fatal(err)
	}
	if _, revoked, _ := pg.SessionByRefreshHash(ctx, h9); !revoked {
		t.Fatal("revocation not persisted")
	}
}

func TestPG_ChatRoundtrip(t *testing.T) {
	pg := pgOrSkip(t)
	ctx := context.Background()
	sfx := store_testID(t)

	a, err := pg.CreateUser(ctx, "pa-"+sfx+"@x.io")
	if err != nil {
		t.Fatal(err)
	}
	b, err := pg.CreateUser(ctx, "pb-"+sfx+"@x.io")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = pg.CompleteProfile(ctx, a.ID, "A", "pa-"+sfx+"#1")
	_, _ = pg.CompleteProfile(ctx, b.ID, "B", "pb-"+sfx+"#1")

	// direct chat needs mutual contacts
	if _, _, err := pg.OpenDirectChat(ctx, a.ID, b.ID); err != store.ErrForbidden {
		t.Fatalf("not-mutual open: %v", err)
	}
	if _, err := pg.RequestContact(ctx, a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	ct, err := pg.RequestContact(ctx, b.ID, a.ID)
	if err != nil || !ct.Mutual {
		t.Fatalf("mutual: %v %v", ct, err)
	}

	chat, created, err := pg.OpenDirectChat(ctx, a.ID, b.ID)
	if err != nil || !created {
		t.Fatalf("open: %v created=%v", err, created)
	}
	if chat.Peer == nil || chat.Peer.ID != b.ID {
		t.Fatalf("peer wrong: %+v", chat.Peer)
	}
	// reopen → same chat
	chat2, created, _ := pg.OpenDirectChat(ctx, b.ID, a.ID)
	if created || chat2.ID != chat.ID {
		t.Fatal("reopen should return existing chat")
	}
	// self-chat
	self, created, err := pg.OpenDirectChat(ctx, a.ID, a.ID)
	if err != nil || !created || self.Peer == nil || self.Peer.ID != a.ID {
		t.Fatalf("self-chat: %v %+v", err, self)
	}

	// send + nonce replay
	m, created, err := pg.SendMessage(ctx, &store.Message{
		ChatID: chat.ID, SenderID: a.ID, Text: strptr("hi"), ClientNonce: "n1",
	})
	if err != nil || !created || m.Seq != 1 {
		t.Fatalf("send: %v seq=%d created=%v", err, m.Seq, created)
	}
	dup, created, err := pg.SendMessage(ctx, &store.Message{
		ChatID: chat.ID, SenderID: a.ID, Text: strptr("hi"), ClientNonce: "n1",
	})
	if err != nil || created || dup.ID != m.ID {
		t.Fatalf("nonce replay: %v created=%v ids %v/%v", err, created, dup.ID, m.ID)
	}
	m2, _, _ := pg.SendMessage(ctx, &store.Message{
		ChatID: chat.ID, SenderID: b.ID, Text: strptr("yo"), ClientNonce: "n2",
	})
	if m2.Seq != 2 {
		t.Fatalf("seq: %d", m2.Seq)
	}

	// foreign user invisible
	c, _ := pg.CreateUser(ctx, "pc-"+sfx+"@x.io")
	if _, err := pg.ChatByID(ctx, chat.ID, c.ID); err != store.ErrNotFound {
		t.Fatalf("foreign chat: %v", err)
	}
	if _, _, err := pg.SendMessage(ctx, &store.Message{
		ChatID: chat.ID, SenderID: c.ID, Text: strptr("x"), ClientNonce: "n",
	}); err != store.ErrNotFound {
		t.Fatalf("foreign send: %v", err)
	}

	// pagination + unread + read cursor
	sums, err := pg.ListChatSummaries(ctx, b.ID)
	if err != nil || len(sums) != 1 {
		t.Fatalf("summaries: %v n=%d", err, len(sums))
	}
	if sums[0].UnreadCount != 1 || sums[0].LastMessage == nil || sums[0].LastMessage.Seq != 2 {
		t.Fatalf("summary: %+v", sums[0])
	}
	if err := pg.MarkRead(ctx, chat.ID, b.ID, 99); err != nil {
		t.Fatal(err)
	}
	sums, _ = pg.ListChatSummaries(ctx, b.ID)
	if sums[0].UnreadCount != 0 {
		t.Fatal("markRead")
	}

	// around window
	msgs, next, newer, err := pg.ListMessages(ctx, chat.ID, store.MessageQuery{AroundID: m.ID, Limit: 4})
	if err != nil || len(msgs) != 2 {
		t.Fatalf("around: %v n=%d", err, len(msgs))
	}
	if newer != nil || next != nil {
		t.Fatalf("full window should have no cursors: %v %v", next, newer)
	}
	// unknown around id → window centered past the tail (mock parity):
	// limit=2 → half=1 → only the last message fits
	msgs, _, _, _ = pg.ListMessages(ctx, chat.ID, store.MessageQuery{
		AroundID: "00000000-0000-0000-0000-000000000000", Limit: 2})
	if len(msgs) != 1 || msgs[0].Seq != 2 {
		t.Fatalf("around unknown: %v", msgs)
	}

	// pinned + search + delete
	if _, err := pg.SetMessagePinned(ctx, m.ID, a.ID, true); err != nil {
		t.Fatal(err)
	}
	msgs, _, _, _ = pg.ListMessages(ctx, chat.ID, store.MessageQuery{Pinned: true})
	if len(msgs) != 1 {
		t.Fatalf("pinned: %d", len(msgs))
	}
	msgs, _, _, _ = pg.ListMessages(ctx, chat.ID, store.MessageQuery{Q: "yo"})
	if len(msgs) != 1 || msgs[0].Seq != 2 {
		t.Fatalf("search: %v", msgs)
	}
	if _, err := pg.EditMessage(ctx, m2.ID, a.ID, "nope"); err != store.ErrForbidden {
		t.Fatalf("foreign edit: %v", err)
	}
	// the rejected edit must not have mutated the row
	if got, _ := pg.MessageByID(ctx, m2.ID); *got.Text != "yo" {
		t.Fatalf("foreign edit leaked: %q", *got.Text)
	}
	if err := pg.DeleteMessage(ctx, m.ID, b.ID); err != store.ErrForbidden {
		t.Fatalf("foreign delete: %v", err)
	}
	if err := pg.DeleteMessage(ctx, m.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	msgs, _, _, _ = pg.ListMessages(ctx, chat.ID, store.MessageQuery{})
	var tomb *store.Message
	for i := range msgs {
		if msgs[i].ID == m.ID {
			tomb = &msgs[i]
		}
	}
	if tomb == nil || tomb.DeletedAt == nil || tomb.Text != nil || len(msgs) != 2 {
		t.Fatalf("expected the deleted message as a redacted tombstone: %+v", msgs)
	}
}

func TestPG_GroupRoundtrip(t *testing.T) {
	pg := pgOrSkip(t)
	ctx := context.Background()
	sfx := store_testID(t)

	o, _ := pg.CreateUser(ctx, "go-"+sfx+"@x.io")
	m, _ := pg.CreateUser(ctx, "gm-"+sfx+"@x.io")
	_, _ = pg.CompleteProfile(ctx, o.ID, "O", "go-"+sfx+"#1")
	_, _ = pg.CompleteProfile(ctx, m.ID, "M", "gm-"+sfx+"#1")

	// contacts-only gate: no contact → forbidden
	if _, err := pg.CreateGroup(ctx, o.ID, "g", []string{m.ID}); err != store.ErrForbidden {
		t.Fatalf("non-contact create: %v", err)
	}
	if _, err := pg.RequestContact(ctx, o.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	// a one-way request is still not enough: the gate needs a mutual pair
	if _, err := pg.CreateGroup(ctx, o.ID, "g", []string{m.ID}); err != store.ErrForbidden {
		t.Fatalf("pending-request create: %v", err)
	}
	if r, err := pg.RequestContact(ctx, m.ID, o.ID); err != nil || !r.Mutual {
		t.Fatalf("accept by reverse request: %v %v", r, err)
	}
	g, err := pg.CreateGroup(ctx, o.ID, "squad", []string{m.ID})
	if err != nil {
		t.Fatal(err)
	}
	// invited, not joined — consent gate
	if g.Type != "group" || len(g.Members) != 1 || g.Members[0].Role != "owner" || len(g.Invited) != 1 {
		t.Fatalf("roster: %+v invited=%+v", g.Members, g.Invited)
	}
	if _, err := pg.ChatByID(ctx, g.ID, m.ID); err != store.ErrNotFound {
		t.Fatalf("invitee must not see the group: %v", err)
	}
	if g, err = pg.AcceptGroupInvite(ctx, g.ID, m.ID); err != nil || len(g.Members) != 2 || len(g.Invited) != 0 {
		t.Fatalf("accept invite: %v %+v", err, g)
	}

	// member without rights is denied; granted rights unlock
	if _, err := pg.SetGroupTitle(ctx, g.ID, m.ID, "hax"); err != store.ErrForbidden {
		t.Fatalf("member title: %v", err)
	}
	if _, err := pg.SetMemberRights(ctx, g.ID, o.ID, m.ID,
		store.MemberRights{EditInfo: true, PinMessages: true}); err != nil {
		t.Fatal(err)
	}
	g2, err := pg.SetGroupTitle(ctx, g.ID, m.ID, "renamed")
	if err != nil || *g2.Title != "renamed" {
		t.Fatalf("member title after grant: %v", err)
	}

	// pin right applies to messages in groups
	msg, _, err := pg.SendMessage(ctx, &store.Message{
		ChatID: g.ID, SenderID: o.ID, Text: strptr("pin me"), ClientNonce: "p" + sfx,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pg.SetMessagePinned(ctx, msg.ID, m.ID, true); err != nil {
		t.Fatalf("member pin with right: %v", err)
	}

	// existence privacy at the store level: a stranger must see
	// ErrNotFound on every group op — never Forbidden, which would
	// leak "chat exists / target is a member / target is the owner"
	s, _ := pg.CreateUser(ctx, "gs-"+sfx+"@x.io")
	for _, fn := range []func() error{
		func() error { _, e := pg.SetGroupTitle(ctx, g.ID, s.ID, "x"); return e },
		func() error { _, e := pg.AddGroupMembers(ctx, g.ID, s.ID, []string{m.ID}); return e },
		func() error { return pg.RemoveGroupMember(ctx, g.ID, s.ID, m.ID) },
		func() error { return pg.RemoveGroupMember(ctx, g.ID, s.ID, o.ID) },
		func() error { _, e := pg.SetMemberRights(ctx, g.ID, s.ID, m.ID, store.MemberRights{}); return e },
		func() error { return pg.TransferOwnership(ctx, g.ID, s.ID, m.ID) },
	} {
		if err := fn(); err != store.ErrNotFound {
			t.Fatalf("stranger op must hide existence: %v", err)
		}
	}
	// group ops on a direct chat id are NotFound, not Forbidden
	dc, _, _ := pg.OpenDirectChat(ctx, o.ID, m.ID)
	if _, err := pg.SetGroupTitle(ctx, dc.ID, o.ID, "x"); err != store.ErrNotFound {
		t.Fatalf("direct-chat group op: %v", err)
	}

	// owner cannot be removed; transfer then former owner may leave
	if err := pg.RemoveGroupMember(ctx, g.ID, o.ID, o.ID); err != store.ErrForbidden {
		t.Fatalf("owner self-remove: %v", err)
	}
	if err := pg.TransferOwnership(ctx, g.ID, o.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := pg.RemoveGroupMember(ctx, g.ID, o.ID, o.ID); err != nil {
		t.Fatalf("former owner leave: %v", err)
	}
	gm, _ := pg.Membership(ctx, g.ID, m.ID)
	if gm.Role != "owner" {
		t.Fatalf("new owner: %v", gm.Role)
	}
}

func strptr(s string) *string { return &s }

func store_testID(t *testing.T) string {
	// unique suffix per run — the dev DB is persistent across test runs
	n := time.Now().UnixNano() % 0xffffff
	return fmt.Sprintf("%s%x", t.Name()[7:11], n)
}

// Existing codes fall under the 30-day rule (migration 0006): a code without
// expiry gets one, a far-future code is cut back, a short one is untouched.
func TestPG_InvitesNeverLiveBeyond30Days(t *testing.T) {
	pg := pgOrSkip(t)
	ctx := context.Background()
	long := time.Now().Add(400 * 24 * time.Hour)
	short := time.Now().Add(3 * 24 * time.Hour)
	suffix := time.Now().UnixNano()
	for code, exp := range map[string]*time.Time{
		fmt.Sprintf("T-NONE-%d", suffix):  nil,
		fmt.Sprintf("T-LONG-%d", suffix):  &long,
		fmt.Sprintf("T-SHORT-%d", suffix): &short,
	} {
		if err := pg.CreateInvite(ctx, code, 1, exp); err != nil {
			t.Fatal(err)
		}
	}
	// re-run the migration's statement (idempotent by construction)
	sqlText, err := os.ReadFile("migrations/0006_invites_expire.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pg.Pool().Exec(ctx, string(sqlText)); err != nil {
		t.Fatal(err)
	}
	invites, _ := pg.ListInvites(ctx)
	for _, i := range invites {
		if !strings.Contains(i.Code, fmt.Sprint(suffix)) {
			continue
		}
		if i.ExpiresAt == nil || time.Until(*i.ExpiresAt) > 31*24*time.Hour {
			t.Fatalf("%s still outlives 30 days: %v", i.Code, i.ExpiresAt)
		}
		if strings.HasPrefix(i.Code, "T-SHORT") && time.Until(*i.ExpiresAt) > 4*24*time.Hour {
			t.Fatalf("a short code must keep its expiry: %v", i.ExpiresAt)
		}
	}
}
