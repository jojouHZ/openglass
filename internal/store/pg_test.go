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

	email := "pgtest-" + store_testID(t) + "@x.io"
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

	tag := "pgt" + store_testID(t) + "#0001"
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
	u2, err := pg.CreateUser(ctx, "pgtest2-"+store_testID(t)+"@x.io")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pg.CompleteProfile(ctx, u2.ID, "Other", tag); err != store.ErrConflict {
		t.Fatalf("expected ErrConflict on duplicate tag, got %v", err)
	}

	sess, err := pg.CreateSession(ctx, u.ID, "pg-test", []byte{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	got, revoked, err := pg.SessionByRefreshHash(ctx, []byte{1, 2, 3})
	if err != nil || revoked || got.ID != sess.ID {
		t.Fatalf("session lookup: %v", err)
	}
	if err := pg.RotateSessionRefresh(ctx, sess.ID, []byte{9, 9}); err != nil {
		t.Fatal(err)
	}
	if _, revoked, _ := pg.SessionByRefreshHash(ctx, []byte{9, 9}); revoked {
		t.Fatal("rotated session wrongly revoked")
	}
	if err := pg.RevokeSession(ctx, sess.ID); err != nil {
		t.Fatal(err)
	}
	if _, revoked, _ := pg.SessionByRefreshHash(ctx, []byte{9, 9}); !revoked {
		t.Fatal("revocation not persisted")
	}
}

func store_testID(t *testing.T) string {
	// unique suffix per run — the dev DB is persistent across test runs
	n := time.Now().UnixNano() % 0xffffff
	return fmt.Sprintf("%s%x", t.Name()[7:11], n)
}
