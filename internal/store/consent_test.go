// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store_test

import (
	"context"
	"testing"

	"github.com/jojouHZ/openglass/internal/store"
)

// consentStore — what the parity suite needs; PG and Mem both satisfy it.
type consentStore interface {
	store.AuthStore
	store.ChatStore
}

func mkUser(t *testing.T, st consentStore, name string) *store.User {
	t.Helper()
	u, err := st.CreateUser(context.Background(), name+"-"+store_testID(t)+"@x.io")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// TestMem_ContactConsent / TestPG_ContactConsent run the SAME assertions on
// both stores — the in-memory twin must not drift from Postgres.
func TestMem_ContactConsent(t *testing.T) { runConsentSuite(t, store.NewMem()) }
func TestPG_ContactConsent(t *testing.T)  { runConsentSuite(t, pgOrSkip(t)) }

func runConsentSuite(t *testing.T, st consentStore) {
	ctx := context.Background()
	a, b, c := mkUser(t, st, "a"), mkUser(t, st, "b"), mkUser(t, st, "c")

	rel := func(x, y string) string {
		r, err := st.Relationship(ctx, x, y)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}

	// self / unknown
	if _, err := st.RequestContact(ctx, a.ID, a.ID); err != store.ErrInvalid {
		t.Fatalf("self request: %v", err)
	}
	if _, err := st.RequestContact(ctx, a.ID, "00000000-0000-0000-0000-000000000000"); err != store.ErrNotFound {
		t.Fatalf("unknown target: %v", err)
	}

	// request: pending on both sides, NO contact yet
	r, err := st.RequestContact(ctx, a.ID, b.ID)
	if err != nil || r.Mutual || r.Existing || r.Request == nil {
		t.Fatalf("request: %+v %v", r, err)
	}
	if rel(a.ID, b.ID) != "contact_outgoing" || rel(b.ID, a.ID) != "contact_incoming" {
		t.Fatalf("relationships: %s / %s", rel(a.ID, b.ID), rel(b.ID, a.ID))
	}
	if cs, _ := st.ListContacts(ctx, a.ID); len(cs) != 0 {
		t.Fatalf("a request must not create a contact: %+v", cs)
	}
	if ok, _ := st.AreMutual(ctx, a.ID, b.ID); ok {
		t.Fatal("pending request must not be mutual")
	}
	if _, _, err := st.OpenDirectChat(ctx, a.ID, b.ID); err != store.ErrForbidden {
		t.Fatalf("direct chat before consent: %v", err)
	}
	in, out, _ := st.ListContactRequests(ctx, b.ID)
	if len(in) != 1 || in[0].User.ID != a.ID || len(out) != 0 {
		t.Fatalf("b lists: in=%+v out=%+v", in, out)
	}

	// resend is an idempotent no-op
	if r, err := st.RequestContact(ctx, a.ID, b.ID); err != nil || !r.Existing {
		t.Fatalf("resend: %+v %v", r, err)
	}

	// silent decline: hidden from b, still "pending" for a, resend stays a no-op
	if err := st.DeclineContactRequest(ctx, b.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if in, _, _ = st.ListContactRequests(ctx, b.ID); len(in) != 0 {
		t.Fatalf("declined request must vanish for the target: %+v", in)
	}
	if _, out, _ = st.ListContactRequests(ctx, a.ID); len(out) != 1 {
		t.Fatalf("declined request must still look pending to the requester: %+v", out)
	}
	if rel(a.ID, b.ID) != "contact_outgoing" || rel(b.ID, a.ID) != "none" {
		t.Fatalf("after decline: %s / %s", rel(a.ID, b.ID), rel(b.ID, a.ID))
	}
	if r, err := st.RequestContact(ctx, a.ID, b.ID); err != nil || !r.Existing {
		t.Fatalf("resend after decline: %+v %v", r, err)
	}
	if err := st.DeclineContactRequest(ctx, b.ID, a.ID); err != store.ErrNotFound {
		t.Fatalf("second decline: %v", err)
	}
	if _, err := st.AcceptContactRequest(ctx, b.ID, a.ID); err != store.ErrNotFound {
		t.Fatalf("declined request cannot be accepted: %v", err)
	}

	// the target changes their mind by adding back: reverse request collapses
	r, err = st.RequestContact(ctx, b.ID, a.ID)
	if err != nil || !r.Mutual || r.Contact == nil {
		t.Fatalf("reverse collapse: %+v %v", r, err)
	}
	if ok, _ := st.AreMutual(ctx, a.ID, b.ID); !ok || rel(a.ID, b.ID) != "contact_mutual" {
		t.Fatal("expected mutual")
	}
	if _, out, _ = st.ListContactRequests(ctx, a.ID); len(out) != 0 {
		t.Fatalf("collapsed request must be gone: %+v", out)
	}
	if _, err := st.RequestContact(ctx, a.ID, b.ID); err != store.ErrConflict {
		t.Fatalf("request to a contact: %v", err)
	}
	if _, _, err := st.OpenDirectChat(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("direct chat after consent: %v", err)
	}
	ids, _ := st.MutualContactIDs(ctx, a.ID)
	if len(ids) != 1 || ids[0] != b.ID {
		t.Fatalf("mutual ids: %v", ids)
	}

	// explicit accept + cancel on a fresh pair
	if _, err := st.RequestContact(ctx, a.ID, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.CancelContactRequest(ctx, a.ID, c.ID); err != nil {
		t.Fatal(err)
	}
	if rel(a.ID, c.ID) != "none" {
		t.Fatal("cancel must clear the request")
	}
	if err := st.CancelContactRequest(ctx, a.ID, c.ID); err != store.ErrNotFound {
		t.Fatalf("second cancel: %v", err)
	}
	_, _ = st.RequestContact(ctx, c.ID, a.ID)
	ct, err := st.AcceptContactRequest(ctx, a.ID, c.ID)
	if err != nil || !ct.Mutual || ct.User.ID != c.ID {
		t.Fatalf("accept: %+v %v", ct, err)
	}
	if cs, _ := st.ListContacts(ctx, c.ID); len(cs) != 1 || cs[0].User.ID != a.ID {
		t.Fatalf("both edges must exist: %+v", cs)
	}

	// unfriend removes BOTH edges
	if err := st.RemoveContact(ctx, a.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	if ok, _ := st.AreMutual(ctx, a.ID, b.ID); ok {
		t.Fatal("remove must drop the pair")
	}
	if cs, _ := st.ListContacts(ctx, b.ID); len(cs) != 0 {
		t.Fatalf("other side keeps a ghost edge: %+v", cs)
	}
	if err := st.RemoveContact(ctx, a.ID, b.ID); err != store.ErrNotFound {
		t.Fatalf("second remove: %v", err)
	}

	// ---- group invites ----
	d := mkUser(t, st, "d")
	_, _ = st.RequestContact(ctx, a.ID, d.ID)
	if _, err := st.CreateGroup(ctx, a.ID, "x", []string{d.ID}); err != store.ErrForbidden {
		t.Fatalf("pending request must not unlock group invites: %v", err)
	}
	_, _ = st.RequestContact(ctx, d.ID, a.ID)

	g, err := st.CreateGroup(ctx, a.ID, "ops", []string{c.ID, d.ID})
	if err != nil || len(g.Members) != 1 || len(g.Invited) != 2 {
		t.Fatalf("create: %+v %v", g, err)
	}
	if _, err := st.ChatByID(ctx, g.ID, c.ID); err != store.ErrNotFound {
		t.Fatalf("invitee sees the group: %v", err)
	}
	if ok, _ := st.IsChatMember(ctx, g.ID, c.ID); ok {
		t.Fatal("invitee must not be a member")
	}
	if ms, _ := st.ChatMemberIDs(ctx, g.ID); len(ms) != 1 {
		t.Fatalf("fan-out must exclude invitees: %v", ms)
	}
	sums, _ := st.ListChatSummaries(ctx, c.ID)
	for _, s := range sums {
		if s.ID == g.ID {
			t.Fatal("group leaked into the invitee's chat list")
		}
	}
	invs, _ := st.ListGroupInvites(ctx, c.ID)
	if len(invs) != 1 || invs[0].ChatID != g.ID || invs[0].Inviter.ID != a.ID || invs[0].MemberCount != 1 {
		t.Fatalf("invites: %+v", invs)
	}

	// re-invite is a silent no-op; silent decline hides it from the invitee only
	if ids, err := st.AddGroupMembers(ctx, g.ID, a.ID, []string{c.ID, d.ID}); err != nil || len(ids) != 0 {
		t.Fatalf("re-invite: %v %v", ids, err)
	}
	if err := st.DeclineGroupInvite(ctx, g.ID, d.ID); err != nil {
		t.Fatal(err)
	}
	if invs, _ = st.ListGroupInvites(ctx, d.ID); len(invs) != 0 {
		t.Fatalf("declined invite visible: %+v", invs)
	}
	if ids, _ := st.AddGroupMembers(ctx, g.ID, a.ID, []string{d.ID}); len(ids) != 0 {
		t.Fatalf("declined user must not be re-notified: %v", ids)
	}
	if v, _ := st.ChatByID(ctx, g.ID, a.ID); len(v.Invited) != 2 {
		t.Fatalf("members still see both as invited: %+v", v.Invited)
	}
	if err := st.DeclineGroupInvite(ctx, g.ID, d.ID); err != store.ErrNotFound {
		t.Fatalf("second decline: %v", err)
	}
	if _, err := st.AcceptGroupInvite(ctx, g.ID, d.ID); err != store.ErrNotFound {
		t.Fatalf("declined invite cannot be accepted: %v", err)
	}

	// accept → member
	joined, err := st.AcceptGroupInvite(ctx, g.ID, c.ID)
	if err != nil || len(joined.Members) != 2 {
		t.Fatalf("accept: %+v %v", joined, err)
	}
	if ok, _ := st.IsChatMember(ctx, g.ID, c.ID); !ok {
		t.Fatal("accepted invitee must be a member")
	}
	if _, err := st.AcceptGroupInvite(ctx, g.ID, c.ID); err != store.ErrNotFound {
		t.Fatalf("accept twice: %v", err)
	}

	// adding a non-mutual user is forbidden; a stranger gets 404-equivalent
	e := mkUser(t, st, "e")
	if _, err := st.AddGroupMembers(ctx, g.ID, a.ID, []string{e.ID}); err != store.ErrForbidden {
		t.Fatalf("non-mutual add: %v", err)
	}
	if _, err := st.AddGroupMembers(ctx, g.ID, e.ID, []string{c.ID}); err != store.ErrNotFound {
		t.Fatalf("stranger add must hide the group: %v", err)
	}
}
