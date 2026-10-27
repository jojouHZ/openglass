// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package store_test

import (
	"context"
	"strings"
	"sync"
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

// Crossing requests fired at the same instant must always end mutual — never
// "both pending". Runs against both stores.
func TestMem_CrossingRequestsConverge(t *testing.T) { runCrossing(t, store.NewMem()) }
func TestPG_CrossingRequestsConverge(t *testing.T)  { runCrossing(t, pgOrSkip(t)) }

func runCrossing(t *testing.T, st consentStore) {
	ctx := context.Background()
	for i := 0; i < 30; i++ {
		a, b := mkUser(t, st, "xa"), mkUser(t, st, "xb")
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = st.RequestContact(ctx, a.ID, b.ID) }()
		go func() { defer wg.Done(); _, _ = st.RequestContact(ctx, b.ID, a.ID) }()
		wg.Wait()
		if ok, _ := st.AreMutual(ctx, a.ID, b.ID); !ok {
			in, out, _ := st.ListContactRequests(ctx, a.ID)
			t.Fatalf("iteration %d: crossing requests did not converge (in=%d out=%d)", i, len(in), len(out))
		}
		if in, out, _ := st.ListContactRequests(ctx, a.ID); len(in)+len(out) != 0 {
			t.Fatalf("iteration %d: leftover requests after convergence", i)
		}
	}
}

// Tombstones and system lines — same behaviour on both stores.
func TestMem_TimelineEvents(t *testing.T) { runTimeline(t, store.NewMem()) }
func TestPG_TimelineEvents(t *testing.T)  { runTimeline(t, pgOrSkip(t)) }

func runTimeline(t *testing.T, st consentStore) {
	ctx := context.Background()
	a, b := mkUser(t, st, "ta"), mkUser(t, st, "tb")
	_, _ = st.RequestContact(ctx, a.ID, b.ID)
	_, _ = st.RequestContact(ctx, b.ID, a.ID)
	chat, _, err := st.OpenDirectChat(ctx, a.ID, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if id, ok, err := st.DirectChatBetween(ctx, b.ID, a.ID); err != nil || !ok || id != chat.ID {
		t.Fatalf("DirectChatBetween: %q %v %v", id, ok, err)
	}
	if _, ok, _ := st.DirectChatBetween(ctx, a.ID, mkUser(t, st, "tc").ID); ok {
		t.Fatal("no chat expected for a stranger pair")
	}

	secret := "retract me"
	m1, _, _ := st.SendMessage(ctx, &store.Message{ChatID: chat.ID, SenderID: a.ID, Text: &secret, ClientNonce: "t1"})
	sys, err := st.AddSystemMessage(ctx, chat.ID, a.ID, store.SystemEvent{Type: "contact_removed", ActorID: a.ID})
	if err != nil || sys.Kind != "system" || sys.SystemEvent == nil || sys.SystemEvent.ActorID != a.ID || sys.Text != nil {
		t.Fatalf("system message: %+v %v", sys, err)
	}
	if sys.Seq != m1.Seq+1 {
		t.Fatalf("system message must take the next seq: %d after %d", sys.Seq, m1.Seq)
	}
	if err := st.DeleteMessage(ctx, m1.ID, a.ID); err != nil {
		t.Fatal(err)
	}

	msgs, _, _, _ := st.ListMessages(ctx, chat.ID, store.MessageQuery{})
	if len(msgs) != 2 || msgs[0].ID != m1.ID || msgs[1].ID != sys.ID {
		t.Fatalf("timeline order/tombstone: %+v", msgs)
	}
	if msgs[0].DeletedAt == nil || msgs[0].Text != nil || msgs[0].Pinned || len(msgs[0].Attachments) != 0 {
		t.Fatalf("tombstone must be redacted: %+v", msgs[0])
	}
	if msgs[1].Kind != "system" || msgs[1].SystemEvent == nil || msgs[1].SystemEvent.Type != "contact_removed" {
		t.Fatalf("system line lost its event: %+v", msgs[1])
	}
	if found, _, _, _ := st.ListMessages(ctx, chat.ID, store.MessageQuery{Q: "retract"}); len(found) != 0 {
		t.Fatalf("search must not see a tombstone: %+v", found)
	}
	// the system line counts as unread for the other side
	sums, _ := st.ListChatSummaries(ctx, b.ID)
	for _, s := range sums {
		if s.ID == chat.ID && (s.UnreadCount != 1 || s.LastMessage == nil || s.LastMessage.Kind != "system") {
			t.Fatalf("summary after a system line: unread=%d last=%+v", s.UnreadCount, s.LastMessage)
		}
	}
}

// Reports — same behaviour on both stores.
func TestMem_Reports(t *testing.T) { runReports(t, store.NewMem()) }
func TestPG_Reports(t *testing.T)  { runReports(t, pgOrSkip(t)) }

func runReports(t *testing.T, st consentStore) {
	ctx := context.Background()
	a, b := mkUser(t, st, "ra"), mkUser(t, st, "rb")

	if _, err := st.CreateReport(ctx, a.ID, a.ID, "me"); err != store.ErrInvalid {
		t.Fatalf("self report: %v", err)
	}
	for _, bad := range []string{"", "  \t\n ", strings.Repeat("x", 1025)} {
		if _, err := st.CreateReport(ctx, a.ID, b.ID, bad); err != store.ErrInvalid {
			t.Fatalf("reason %q…: %v", bad[:min(len(bad), 8)], err)
		}
	}
	if _, err := st.CreateReport(ctx, a.ID, "00000000-0000-4000-8000-000000000000", "x"); err != store.ErrNotFound {
		t.Fatalf("unknown target: %v", err)
	}

	r1, err := st.CreateReport(ctx, a.ID, b.ID, "  rude  ")
	if err != nil || r1.Reason != "rude" || r1.Status != "open" || r1.ID == "" {
		t.Fatalf("create: %+v %v", r1, err)
	}
	if _, err := st.CreateReport(ctx, b.ID, a.ID, strings.Repeat("é", 1024)); err != nil {
		t.Fatalf("1024 characters must be accepted: %v", err)
	}

	open, _ := st.ListReports(ctx, "open")
	var mine int
	for _, r := range open {
		if r.ID == r1.ID {
			mine++
			if r.ReporterID == nil || *r.ReporterID != a.ID || r.TargetUserID == nil || *r.TargetUserID != b.ID {
				t.Fatalf("who: %+v", r)
			}
		}
	}
	if mine != 1 {
		t.Fatalf("created report missing from the open list")
	}

	if err := st.ResolveReport(ctx, r1.ID, "warned"); err != nil {
		t.Fatal(err)
	}
	if err := st.ResolveReport(ctx, "00000000-0000-4000-8000-000000000000", ""); err != store.ErrNotFound {
		t.Fatalf("resolve unknown: %v", err)
	}
	resolved, _ := st.ListReports(ctx, "resolved")
	var found bool
	for _, r := range resolved {
		if r.ID == r1.ID {
			found = r.Status == "resolved" && r.ResolvedAt != nil && r.ResolvedNote != nil && *r.ResolvedNote == "warned"
		}
	}
	if !found {
		t.Fatalf("resolved report not listed correctly: %+v", resolved)
	}
	for _, r := range func() []store.Report { o, _ := st.ListReports(ctx, "open"); return o }() {
		if r.ID == r1.ID {
			t.Fatal("a resolved report must leave the open list")
		}
	}
	if _, err := st.ListReports(ctx, "bogus"); err != store.ErrInvalid {
		t.Fatalf("bad status: %v", err)
	}
}
