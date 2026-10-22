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

// acceptInvite — the invitee joins the group (consent gate: an invite is
// not a membership until accepted).
func acceptInvite(t *testing.T, ts *httptest.Server, chatID, tok string) {
	t.Helper()
	if c, b := post(t, ts, "/api/v1/group-invites/"+chatID+"/accept", `{}`, tok); c != 200 {
		t.Fatalf("accept invite: %d %v", c, b)
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
	cTok, cID := mkUser(t, ts, st, sender, "gc@x.io", "gc#0003")
	sTok, sID := mkUser(t, ts, st, sender, "gs@x.io", "gs#0004") // stranger, no contact

	befriend(t, ts, oTok, bTok, oID, bID)
	befriend(t, ts, oTok, cTok, oID, cID)

	// non-contact id rejected — mutual-contacts-only invites
	if c, _ := post(t, ts, "/api/v1/groups",
		fmt.Sprintf(`{"title":"x","memberIds":[%q]}`, sID), oTok); c != 403 {
		t.Fatalf("non-contact member must be 403, got %d", c)
	}
	// a one-way request is NOT enough (consent model)
	post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, sID), oTok)
	if c, _ := post(t, ts, "/api/v1/groups",
		fmt.Sprintf(`{"title":"x","memberIds":[%q]}`, sID), oTok); c != 403 {
		t.Fatalf("pending request must not unlock invites, got %d", c)
	}
	_ = sTok
	// unknown id → 403 too (don't leak user existence)
	if c, _ := post(t, ts, "/api/v1/groups",
		`{"title":"x","memberIds":["00000000-0000-0000-0000-000000000000"]}`, oTok); c != 403 {
		t.Fatalf("unknown member must be 403")
	}

	g := mkGroup(t, ts, oTok, "squad", bID, cID)
	// invitees are NOT members and cannot see the group until they accept
	code, body := get(t, ts, "/api/v1/chats/"+g, oTok)
	if code != 200 {
		t.Fatalf("getChat: %d", code)
	}
	if ms := membersOf(body); len(ms) != 1 || ms[oID]["role"] != "owner" {
		t.Fatalf("pre-accept roster must be the owner only: %v", ms)
	}
	if inv := body["chat"].(map[string]any)["invited"].([]any); len(inv) != 2 {
		t.Fatalf("invited list: %v", inv)
	}
	if c, _ := get(t, ts, "/api/v1/chats/"+g, bTok); c != 404 {
		t.Fatalf("invitee must get 404 before accepting, got %d", c)
	}
	if c, lb := get(t, ts, "/api/v1/chats", bTok); c != 200 || len(lb["chats"].([]any)) != 0 {
		t.Fatalf("invited group leaked into the chat list: %v", lb)
	}
	if c, _ := send(t, ts, g, bTok, "sneak"); c != 404 {
		t.Fatalf("invitee must not post: %d", c)
	}

	// the invitation is listed; accepting joins
	c, il := get(t, ts, "/api/v1/group-invites", bTok)
	invs := il["invites"].([]any)
	if c != 200 || len(invs) != 1 || invs[0].(map[string]any)["chatId"] != g {
		t.Fatalf("invites: %d %v", c, il)
	}
	acceptInvite(t, ts, g, bTok)
	acceptInvite(t, ts, g, cTok)
	if c, _ := post(t, ts, "/api/v1/group-invites/"+g+"/accept", `{}`, bTok); c != 404 {
		t.Fatalf("accept twice: %d", c)
	}
	_, body = get(t, ts, "/api/v1/chats/"+g, oTok)
	ms := membersOf(body)
	if ms[oID]["role"] != "owner" || ms[bID]["role"] != "member" || ms[cID]["role"] != "member" {
		t.Fatalf("roster: %v", ms)
	}
}

func TestGroup_DeclineIsSilent(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "do@x.io", "do#0001")
	bTok, bID := mkUser(t, ts, st, sender, "db@x.io", "db#0002")
	befriend(t, ts, oTok, bTok, oID, bID)
	g := mkGroup(t, ts, oTok, "quiet", bID)

	if c, _ := post(t, ts, "/api/v1/group-invites/"+g+"/decline", `{}`, bTok); c != 204 {
		t.Fatalf("decline: %d", c)
	}
	if _, il := get(t, ts, "/api/v1/group-invites", bTok); len(il["invites"].([]any)) != 0 {
		t.Fatalf("declined invite still listed: %v", il)
	}
	// the owner is not told: the user still reads as invited, re-invite is a no-op
	_, body := get(t, ts, "/api/v1/chats/"+g, oTok)
	if len(body["chat"].(map[string]any)["invited"].([]any)) != 1 {
		t.Fatalf("decline must not be reported to members: %v", body)
	}
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, bID), oTok); c != 204 {
		t.Fatalf("re-invite after decline: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/group-invites/"+g+"/accept", `{}`, bTok); c != 404 {
		t.Fatalf("declined invite must not be acceptable: %d", c)
	}
}

func TestGroup_RightsMatrix(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "ro@x.io", "ro#0001")
	mTok, mID := mkUser(t, ts, st, sender, "rm@x.io", "rm#0002")
	xTok, xID := mkUser(t, ts, st, sender, "rx@x.io", "rx#0003")
	befriend(t, ts, oTok, mTok, oID, mID)
	befriend(t, ts, oTok, xTok, oID, xID)
	g := mkGroup(t, ts, oTok, "raid", mID)
	acceptInvite(t, ts, g, mTok)

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
	// but member can only invite own mutual contacts — x is not m's contact
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, xID), mTok); c != 403 {
		t.Fatalf("member invite non-contact: %d", c)
	}
	befriend(t, ts, mTok, xTok, mID, xID)
	if c, _ := post(t, ts, "/api/v1/groups/"+g+"/members",
		fmt.Sprintf(`{"memberIds":[%q]}`, xID), mTok); c != 204 {
		t.Fatalf("member invite contact: %d", c)
	}
}

func TestGroup_MessageRights(t *testing.T) {
	ts, st, sender := newServer(t)
	oTok, oID := mkUser(t, ts, st, sender, "mo@x.io", "mo#0001")
	mTok, mID := mkUser(t, ts, st, sender, "mm@x.io", "mm#0002")
	befriend(t, ts, oTok, mTok, oID, mID)
	g := mkGroup(t, ts, oTok, "msg", mID)
	acceptInvite(t, ts, g, mTok)

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
	befriend(t, ts, oTok, mTok, oID, mID)
	g := mkGroup(t, ts, oTok, "own", mID)
	acceptInvite(t, ts, g, mTok)

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
	mTok, mID := mkUser(t, ts, st, sender, "pm@x.io", "pm#0002")
	sTok, sID := mkUser(t, ts, st, sender, "ps@x.io", "ps#0003")
	befriend(t, ts, oTok, mTok, oID, mID)
	g := mkGroup(t, ts, oTok, "secret", mID)
	acceptInvite(t, ts, g, mTok)

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
	befriend(t, ts, oTok, mTok, oID, mID)

	// member listens, then owner creates a group containing them
	mc, _ := wsConnect(t, ts, mTok, 0)
	wsRead(t, mc) // snapshot
	defer func() { _ = mc.Close() }()

	g := mkGroup(t, ts, oTok, "emit", mID)
	// the invitee gets the INVITATION, never the chat itself
	var ev wsFrame
	got := false
	for i := 0; i < 8; i++ {
		ev = wsRead(t, mc)
		if ev.Type == "chat.new" {
			t.Fatalf("invitee received chat.new before accepting: %v", ev.Data)
		}
		if ev.Type == "group.invite" {
			got = true
			if ev.Data["invite"].(map[string]any)["chatId"] != g {
				t.Fatalf("group.invite payload: %v", ev.Data)
			}
			break
		}
	}
	if !got {
		t.Fatal("invitee never got group.invite")
	}
	acceptInvite(t, ts, g, mTok)
	got = false
	for i := 0; i < 8; i++ {
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
		t.Fatal("member never got chat.new after accepting")
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
