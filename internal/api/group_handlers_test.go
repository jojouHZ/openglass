// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// B3 contract tests — groups: party/raid rights, contacts-only invites,
// owner invariants, existence privacy, event fan-out.
package api_test

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// addOne makes target an outgoing contact of the caller — the minimal
// gate for group invites (mutual not required).
func addOne(t *testing.T, ts *httptest.Server, tok, targetID string) {
	t.Helper()
	if c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, targetID), tok); c != 201 {
		t.Fatalf("contact: %d %v", c, b)
	}
}

func mkGroup(t *testing.T, ts *httptest.Server, tok, title string, memberIDs ...string) string {
	t.Helper()
	var ids []string
	for _, id := range memberIDs {
		ids = append(ids, fmt.Sprintf("%q", id))
	}
	c, b := post(t, ts, "/api/v1/groups",
		fmt.Sprintf(`{"title":%q,"memberIds":[%s]}`, title, strings.Join(ids, ",")), tok)
	if c != 201 {
		t.Fatalf("createGroup: %d %v", c, b)
	}
	return b["chat"].(map[string]any)["id"].(string)
}

func membersOf(b map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	for _, m := range b["chat"].(map[string]any)["members"].([]any) {
		mm := m.(map[string]any)
		out[mm["user"].(map[string]any)["id"].(string)] = mm
	}
	return out
}

func TestGroup_CreateFlow(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "go@x.io", "go#0001")
	bTok, bID := mkUser(t, ts, st, sender, "gb@x.io", "gb#0002")
	_, cID := mkUser(t, ts, st, sender, "gc@x.io", "gc#0003")
	_, sID := mkUser(t, ts, st, sender, "gs@x.io", "gs#0004") // stranger, no contact

	addOne(t, ts, oTok, bID)
	addOne(t, ts, oTok, cID)

	// non-contact id rejected — contacts-only invites
	if c, _ := post(t, ts, "/api/v1/groups",
		fmt.Sprintf(`{"title":"x","memberIds":[%q]}`, sID), oTok); c != 403 {
		t.Fatalf("non-contact member must be 403, got %d", c)
	}
	// unknown id → 403 too (don't leak user existence)
	if c, _ := post(t, ts, "/api/v1/groups",
		`{"title":"x","memberIds":["00000000-0000-0000-0000-000000000000"]}`, oTok); c != 403 {
		t.Fatalf("unknown member must be 403")
	}

	g := mkGroup(t, ts, oTok, "squad", bID, cID)
	code, body := get(t, ts, "/api/v1/chats/"+g, oTok)
	if code != 200 {
		t.Fatalf("getChat: %d", code)
	}
	ms := membersOf(body)
	if ms[oID]["role"] != "owner" || ms[bID]["role"] != "member" || ms[cID]["role"] != "member" {
		t.Fatalf("roster: %v", ms)
	}
	_ = bTok
}

func TestGroup_RightsMatrix(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "ro@x.io", "ro#0001")
	mTok, mID := mkUser(t, ts, st, sender, "rm@x.io", "rm#0002")
	xTok, xID := mkUser(t, ts, st, sender, "rx@x.io", "rx#0003")
	addOne(t, ts, oTok, mID)
	addOne(t, ts, oTok, xID)
	g := mkGroup(t, ts, oTok, "raid", mID)

	// member without rights: title, invites, member-removal → 403
	if c, _ := patch(t, ts, "/api/v1/groups/"+g, `{"title":"hax"}`, mTok); c != 403 {
		t.Fatalf("member edit title: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, xID), mTok); c != 403 {
		t.Fatalf("member invite: %d", c)
	}
	if c := del(t, ts, "/api/v1/groups/"+g+"/members/"+oID, mTok); c != 403 {
		t.Fatalf("member remove owner: %d", c)
	}

	// owner grants editInfo + inviteMembers → member can now do both
	code, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+mID,
		`{"rights":{"editInfo":true,"inviteMembers":true}}`, oTok)
	if code != 200 {
		t.Fatalf("setMemberRights: %d", code)
	}
	if c, _ := patch(t, ts, "/api/v1/groups/"+g, `{"title":"new name"}`, mTok); c != 200 {
		t.Fatalf("member edit after grant: %d", c)
	}
	// but member can only invite own contacts — x is not in m's contacts
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, xID), mTok); c != 403 {
		t.Fatalf("member invite non-contact: %d", c)
	}
	addOne(t, ts, mTok, xID)
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, xID), mTok); c != 204 {
		t.Fatalf("member invite contact: %d", c)
	}
	_ = xTok
}

func TestGroup_MessageRights(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, _ := mkUser(t, ts, st, sender, "mo@x.io", "mo#0001")
	mTok, mID := mkUser(t, ts, st, sender, "mm@x.io", "mm#0002")
	addOne(t, ts, oTok, mID)
	g := mkGroup(t, ts, oTok, "msg", mID)

	send(t, ts, g, oTok, "owner post")
	_, mb := get(t, ts, "/api/v1/chats/"+g+"/messages", oTok)
	msgID := mb["messages"].([]any)[0].(map[string]any)["id"].(string)

	// member without pinMessages can't pin
	if c, _ := post(t, ts, "/api/v1/messages/"+msgID+"/pin",
		`{"pinned":true}`, mTok); c != 403 {
		t.Fatalf("member pin: %d", c)
	}
	// ...nor delete another's message
	if c := del(t, ts, "/api/v1/messages/"+msgID, mTok); c != 403 {
		t.Fatalf("member delete: %d", c)
	}
	// owner can both
	if c, _ := post(t, ts, "/api/v1/messages/"+msgID+"/pin",
		`{"pinned":true}`, oTok); c != 200 {
		t.Fatalf("owner pin: %d", c)
	}
	// member granted deleteMessages may delete others' posts
	if c, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+mID,
		`{"rights":{"deleteMessages":true}}`, oTok); c != 200 {
		t.Fatalf("grant deleteMessages: %d", c)
	}
	if c := del(t, ts, "/api/v1/messages/"+msgID, mTok); c != 204 {
		t.Fatalf("member delete with right: %d", c)
	}
}

func TestGroup_OwnerInvariants(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "oo@x.io", "oo#0001")
	mTok, mID := mkUser(t, ts, st, sender, "om@x.io", "om#0002")
	addOne(t, ts, oTok, mID)
	g := mkGroup(t, ts, oTok, "own", mID)

	// owner cannot be removed by anyone, including self
	if c := del(t, ts, "/api/v1/groups/"+g+"/members/"+oID, oTok); c != 403 {
		t.Fatalf("owner self-remove: %d", c)
	}
	// non-owner transfer attempt
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/ownership",
		fmt.Sprintf(`{"newOwnerId":%q}`, oID), mTok); c != 403 {
		t.Fatalf("member transfer: %d", c)
	}
	// transfer to non-member → 404
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/ownership",
		`{"newOwnerId":"00000000-0000-0000-0000-000000000000"}`, oTok); c != 404 {
		t.Fatalf("transfer to stranger: %d", c)
	}
	// member cannot edit own rights (owner-only route)
	if c, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+mID,
		`{"rights":{"editInfo":true}}`, mTok); c != 403 {
		t.Fatalf("self rights grant: %d", c)
	}
	// owner cannot set rights on the owner row
	if c, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+oID,
		`{"rights":{}}`, oTok); c != 403 {
		t.Fatalf("owner rights self-edit: %d", c)
	}

	// real transfer: roles swap atomically
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/ownership",
		fmt.Sprintf(`{"newOwnerId":%q}`, mID), oTok); c != 204 {
		t.Fatalf("transfer: %d", c)
	}
	_, body := get(t, ts, "/api/v1/chats/"+g, mTok)
	ms := membersOf(body)
	if ms[mID]["role"] != "owner" || ms[oID]["role"] != "member" {
		t.Fatalf("roles after transfer: %v", ms)
	}
	// former owner can now leave
	if c := del(t, ts, "/api/v1/groups/"+g+"/members/"+oID, oTok); c != 204 {
		t.Fatalf("former owner leave: %d", c)
	}
}

func TestGroup_Privacy404(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "po@x.io", "po#0001")
	_, mID := mkUser(t, ts, st, sender, "pm@x.io", "pm#0002")
	sTok, sID := mkUser(t, ts, st, sender, "ps@x.io", "ps#0003")
	addOne(t, ts, oTok, mID)
	g := mkGroup(t, ts, oTok, "secret", mID)

	// stranger: every group route is 404, not 403 — existence hidden
	if c, _ := patch(t, ts, "/api/v1/groups/"+g, `{"title":"x"}`, sTok); c != 404 {
		t.Fatalf("stranger edit: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, sID), sTok); c != 404 {
		t.Fatalf("stranger add: %d", c)
	}
	if c := del(t, ts, "/api/v1/groups/"+g+"/members/"+mID, sTok); c != 404 {
		t.Fatalf("stranger remove: %d", c)
	}
	if c, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+mID,
		`{"rights":{}}`, sTok); c != 404 {
		t.Fatalf("stranger rights: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/ownership",
		fmt.Sprintf(`{"newOwnerId":%q}`, sID), sTok); c != 404 {
		t.Fatalf("stranger transfer: %d", c)
	}
	// stranger probing with a *member* target must still get 404 —
	// 403 here would leak both the chat's existence and the roster
	if c, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+mID,
		`{"rights":{}}`, sTok); c != 404 {
		t.Fatalf("stranger rights on member: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/ownership",
		fmt.Sprintf(`{"newOwnerId":%q}`, mID), sTok); c != 404 {
		t.Fatalf("stranger transfer to member: %d", c)
	}
	if c := del(t, ts, "/api/v1/groups/"+g+"/members/"+mID, sTok); c != 404 {
		t.Fatalf("stranger remove member: %d", c)
	}
	// group routes on a *direct* chat id answer 404 too — "not a group"
	// is the same "not found" for privacy purposes
	befriend(t, ts, oTok, sTok, oID, sID)
	d := directChat(t, ts, oTok, sID)
	if c, _ := patch(t, ts, "/api/v1/groups/"+d, `{"title":"x"}`, oTok); c != 404 {
		t.Fatalf("group route on direct chat: %d", c)
	}
	// never in the list
	_, body := get(t, ts, "/api/v1/chats", sTok)
	if len(body["chats"].([]any)) != 1 {
		t.Fatal("stranger sees the group in list")
	}
}

// A removed member's remaining devices learn via chat.updated; the
// added member sees chat.new first (contract ordering).
func TestGroup_Emits(t *testing.T) {
	ts, st, sender, hub := newServerWS(t)
	hub.OfflineGrace = time.Hour // no flapping in-test
	oTok, oID := mkUser(t, ts, st, sender, "eo@x.io", "eo#0001")
	mTok, mID := mkUser(t, ts, st, sender, "em@x.io", "em#0002")
	addOne(t, ts, oTok, mID)

	// member listens, then owner creates a group containing them
	mc, _ := wsConnect(t, ts, mTok, 0)
	wsRead(t, mc) // snapshot
	defer func() { _ = mc.Close() }()

	g := mkGroup(t, ts, oTok, "emit", mID)
	var ev wsFrame
	got := false
	for i := 0; i < 5; i++ {
		ev = wsRead(t, mc)
		if ev.Type == "chat.new" {
			got = true
			if ev.Data["chat"].(map[string]any)["id"] != g {
				t.Fatalf("chat.new payload: %v", ev.Data)
			}
			break
		}
	}
	if !got {
		t.Fatal("member never got chat.new")
	}

	// rights change → chat.updated reaches the member
	if c, _ := patch(t, ts, "/api/v1/groups/"+g+"/members/"+mID,
		`{"rights":{"pinMessages":true}}`, oTok); c != 200 {
		t.Fatalf("setMemberRights: %d", c)
	}
	got = false
	for i := 0; i < 5; i++ {
		ev = wsRead(t, mc)
		if ev.Type == "chat.updated" {
			got = true
			break
		}
	}
	if !got {
		t.Fatal("member never got chat.updated")
	}
	_ = oID
}
