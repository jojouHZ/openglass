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
	if _, err := pg.AddContact(ctx, a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	ct, err := pg.AddContact(ctx, b.ID, a.ID)
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
	if _, err := pg.SetMessagePinned(ctx, m.ID, true); err != nil {
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
	if len(msgs) != 1 {
		t.Fatalf("tombstone leaked: %d", len(msgs))
	}
}

func strptr(s string) *string { return &s }

func store_testID(t *testing.T) string {
	// unique suffix per run — the dev DB is persistent across test runs
	n := time.Now().UnixNano() % 0xffffff
	return fmt.Sprintf("%s%x", t.Name()[7:11], n)
}
