// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// B1 contract tests — contacts, chats, messages against Mem.
package api_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/store"
)

// mkUser runs the real OTP flow for a fresh email and completes the
// profile — returns access token and user id.
func mkUser(t *testing.T, ts *httptest.Server, st *store.Mem, sender *auth.CaptureSender,
	email, tag string) (access, userID string) {
	t.Helper()
	st.SeedInvite("INV-" + email)
	if c, b := post(t, ts, "/api/v1/auth/otp/request",
		fmt.Sprintf(`{"email":%q,"inviteCode":"INV-%s"}`, email, email), ""); c != 202 {
		t.Fatalf("%s request: %d %v", email, c, b)
	}
	otp := sender.Codes[email]
	c, v := post(t, ts, "/api/v1/auth/otp/verify",
		fmt.Sprintf(`{"email":%q,"code":%q,"deviceName":"t"}`, email, otp), "")
	if c != 200 {
		t.Fatalf("%s verify: %d %v", email, c, v)
	}
	access = v["accessToken"].(string)
	c, prof := post(t, ts, "/api/v1/auth/profile",
		fmt.Sprintf(`{"displayName":%q,"requestedTag":%q}`, email, tag), access)
	if c != 200 {
		t.Fatalf("%s profile: %d %v", email, c, prof)
	}
	return access, prof["user"].(map[string]any)["id"].(string)
}

func setupTwoUsers(t *testing.T) (*httptest.Server, *store.Mem, *auth.CaptureSender,
	string, string, string, string) {
	ts, st, sender := newServer(t)
	aTok, aID := mkUser(t, ts, st, sender, "alice@x.io", "alice#0001")
	bTok, bID := mkUser(t, ts, st, sender, "bob@x.io", "bob#0002")
	return ts, st, sender, aTok, aID, bTok, bID
}

func send(t *testing.T, ts *httptest.Server, chatID, tok, text string) (int, map[string]any) {
	return post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":%q,"text":%q}`, "n-"+text, text), tok)
}

// befriend creates mutual contacts — the shortest path to a legal direct chat.
func befriend(t *testing.T, ts *httptest.Server, aTok, bTok, aID, bID string) {
	t.Helper()
	if c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok); c != 201 {
		t.Fatalf("a→b contact: %d %v", c, b)
	}
	if c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, aID), bTok); c != 201 {
		t.Fatalf("b→a contact: %d %v", c, b)
	}
}

func directChat(t *testing.T, ts *httptest.Server, tok, peerID string) string {
	t.Helper()
	c, b := post(t, ts, "/api/v1/chats", fmt.Sprintf(`{"userId":%q}`, peerID), tok)
	if c != 201 && c != 200 {
		t.Fatalf("openDirect: %d %v", c, b)
	}
	return b["chat"].(map[string]any)["id"].(string)
}

func del(t *testing.T, ts *httptest.Server, path, tok string) int {
	t.Helper()
	req, _ := http.NewRequest("DELETE", ts.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func patch(t *testing.T, ts *httptest.Server, path, body, tok string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("PATCH", ts.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// ---- contacts ----

func TestContacts_AddListRemove(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)

	c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	if c != 201 || b["contact"].(map[string]any)["mutual"] != false {
		t.Fatalf("add: %d %v", c, b)
	}
	c, b = post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, aID), bTok)
	if c != 201 || b["contact"].(map[string]any)["mutual"] != true {
		t.Fatalf("mutual add: %d %v", c, b)
	}
	if c, _ := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok); c != 409 {
		t.Fatalf("dup: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/contacts",
		`{"userId":"00000000-0000-0000-0000-000000000000"}`, aTok); c != 404 {
		t.Fatalf("ghost: %d", c)
	}
	c, list := get(t, ts, "/api/v1/contacts", aTok)
	contacts := list["contacts"].([]any)
	if c != 200 || len(contacts) != 1 {
		t.Fatalf("list: %d %v", c, list)
	}
	got := contacts[0].(map[string]any)
	if got["mutual"] != true || got["verifiedAt"] != nil {
		t.Fatalf("contact shape: %v", got)
	}
	if del(t, ts, "/api/v1/contacts/"+bID, aTok) != 204 {
		t.Fatal("remove")
	}
	if del(t, ts, "/api/v1/contacts/"+bID, aTok) != 404 {
		t.Fatal("remove twice should 404")
	}
}

// ---- direct chat ----

func TestOpenDirect_RequiresMutual(t *testing.T) {
	ts, _, _, aTok, _, _, bID := setupTwoUsers(t)
	c, b := post(t, ts, "/api/v1/chats", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	if c != 403 || errCode(b) != "forbidden" {
		t.Fatalf("not-mutual: %d %v", c, b)
	}
}

func TestOpenDirect_SelfChat(t *testing.T) {
	ts, _, _, aTok, aID, _, _ := setupTwoUsers(t)
	chatID := directChat(t, ts, aTok, aID) // saved messages — no mutual needed
	c, b := get(t, ts, "/api/v1/chats/"+chatID, aTok)
	chat := b["chat"].(map[string]any)
	if c != 200 || chat["type"] != "direct" {
		t.Fatalf("self-chat: %d %v", c, b)
	}
	if chat["peer"].(map[string]any)["id"] != aID {
		t.Fatalf("self-chat peer should be self: %v", chat["peer"])
	}
	// reopening returns the same chat with 200
	c, b = post(t, ts, "/api/v1/chats", fmt.Sprintf(`{"userId":%q}`, aID), aTok)
	if c != 200 || b["chat"].(map[string]any)["id"] != chatID {
		t.Fatalf("self-chat reopen: %d %v", c, b)
	}
}

func TestChat_ForeignIs404(t *testing.T) {
	ts, st, sender, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	cTok, _ := mkUser(t, ts, st, sender, "carol@x.io", "carol#0003")

	// a non-member must not even learn the chat exists
	if c, b := get(t, ts, "/api/v1/chats/"+chatID, cTok); c != 404 || errCode(b) != "not_found" {
		t.Fatalf("foreign get: %d %v", c, b)
	}
	if c, _ := send(t, ts, chatID, cTok, "intrude"); c != 404 {
		t.Fatalf("foreign send: %d", c)
	}
	if c, _ := get(t, ts, "/api/v1/chats/"+chatID+"/messages", cTok); c != 404 {
		t.Fatalf("foreign list: %d", c)
	}
}

// ---- messaging ----

func TestMessages_SendListRead(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	c, b := send(t, ts, chatID, aTok, "hello")
	if c != 201 {
		t.Fatalf("send: %d %v", c, b)
	}
	msg := b["message"].(map[string]any)
	if msg["seq"].(float64) != 1 || msg["text"] != "hello" {
		t.Fatalf("message shape: %v", msg)
	}
	if msg["clientNonce"] != "n-hello" {
		t.Fatalf("nonce not echoed: %v", msg)
	}

	// b sees it + unread=1; a's own send is not unread for a
	c, lb := get(t, ts, "/api/v1/chats", bTok)
	if c != 200 || len(lb["chats"].([]any)) != 1 {
		t.Fatalf("b list: %d %v", c, lb)
	}
	summary := lb["chats"].([]any)[0].(map[string]any)
	if summary["unreadCount"].(float64) != 1 {
		t.Fatalf("unread: %v", summary)
	}
	_, lb = get(t, ts, "/api/v1/chats", aTok)
	if lb["chats"].([]any)[0].(map[string]any)["unreadCount"].(float64) != 0 {
		t.Fatal("own message counted as unread")
	}

	// markRead clears unread
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/read", `{"upToSeq":1}`, bTok); c != 204 {
		t.Fatalf("markRead: %d", c)
	}
	_, lb = get(t, ts, "/api/v1/chats", bTok)
	if lb["chats"].([]any)[0].(map[string]any)["unreadCount"].(float64) != 0 {
		t.Fatal("unread not cleared")
	}
}

func TestMessages_NonceIdempotent(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	body := `{"clientNonce":"same","text":"once"}`
	c1, b1 := post(t, ts, "/api/v1/chats/"+chatID+"/messages", body, aTok)
	c2, b2 := post(t, ts, "/api/v1/chats/"+chatID+"/messages", body, aTok)
	if c1 != 201 || c2 != 200 {
		t.Fatalf("replay status: %d then %d", c1, c2)
	}
	id1 := b1["message"].(map[string]any)["id"]
	id2 := b2["message"].(map[string]any)["id"]
	if id1 != id2 {
		t.Fatalf("nonce replay created a second message: %v vs %v", id1, id2)
	}
}

func TestMessages_Pagination(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	for i := 1; i <= 8; i++ {
		if c, _ := send(t, ts, chatID, aTok, "msg"+strconv.Itoa(i)); c != 201 {
			t.Fatalf("send %d: %d", i, c)
		}
	}

	// tail page
	_, p := get(t, ts, "/api/v1/chats/"+chatID+"/messages?limit=3", aTok)
	msgs := p["messages"].([]any)
	if len(msgs) != 3 || msgs[0].(map[string]any)["text"] != "msg6" {
		t.Fatalf("tail: %v", msgs)
	}
	next := p["nextCursor"].(string)

	// before → older page, ascending order preserved
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?limit=3&before="+next, aTok)
	msgs = p["messages"].([]any)
	if len(msgs) != 3 || msgs[0].(map[string]any)["text"] != "msg3" {
		t.Fatalf("before: %v", msgs)
	}

	// around a middle message → window centered on it
	mid := msgs[1].(map[string]any)["id"].(string)
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?around="+mid+"&limit=4", aTok)
	msgs = p["messages"].([]any)
	if p["newerCursor"] == nil {
		t.Fatal("around at middle should expose newerCursor")
	}
	found := false
	for _, m := range msgs {
		if m.(map[string]any)["id"] == mid {
			found = true
		}
	}
	if !found {
		t.Fatalf("around window lacks the anchor: %v", msgs)
	}

	// after = forward from around cursor
	newer := p["newerCursor"].(string)
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?after="+newer, aTok)
	last := p["messages"].([]any)
	if len(last) == 0 || last[len(last)-1].(map[string]any)["text"] != "msg8" {
		t.Fatalf("after: %v", last)
	}
}

func TestMessages_SearchAndPin(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	send(t, ts, chatID, aTok, "red apple")
	send(t, ts, chatID, aTok, "green pear")
	send(t, ts, chatID, bTok, "red cherry")

	// search — seq desc order of matches
	_, p := get(t, ts, "/api/v1/chats/"+chatID+"/messages?q=red", aTok)
	msgs := p["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["text"] != "red cherry" {
		t.Fatalf("search: %v", msgs)
	}
	// q too short → validation_failed
	if c, b := get(t, ts, "/api/v1/chats/"+chatID+"/messages?q=x", aTok); c != 400 || errCode(b) != "validation_failed" {
		t.Fatalf("short q: %d %v", c, b)
	}
	// pin first message, then pinned view shows only it
	mid := msgs[1].(map[string]any)["id"].(string)
	c, pb := post(t, ts, "/api/v1/messages/"+mid+"/pin", `{"pinned":true}`, aTok)
	if c != 200 || pb["message"].(map[string]any)["pinned"] != true {
		t.Fatalf("pin: %d %v", c, pb)
	}
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?pinned=true", aTok)
	if len(p["messages"].([]any)) != 1 {
		t.Fatalf("pinned view: %v", p)
	}
}

func TestMessages_EditDeleteOwnership(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	_, b := send(t, ts, chatID, aTok, "mine")
	mid := b["message"].(map[string]any)["id"].(string)

	// owner edits
	c, eb := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"edited"}`, aTok)
	if c != 200 || eb["message"].(map[string]any)["editedAt"] == nil {
		t.Fatalf("edit: %d %v", c, eb)
	}
	// stranger cannot edit — and the attempt must not mutate the text
	if c, _ := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"hax"}`, bTok); c != 403 {
		t.Fatalf("foreign edit: %d", c)
	}
	_, hb := get(t, ts, "/api/v1/chats/"+chatID+"/messages", bTok)
	if hb["messages"].([]any)[0].(map[string]any)["text"] != "edited" {
		t.Fatalf("foreign edit leaked through: %v", hb["messages"])
	}
	// stranger cannot delete
	if c := del(t, ts, "/api/v1/messages/"+mid, bTok); c != 403 {
		t.Fatalf("foreign delete: %d", c)
	}
	// owner deletes → tombstone excluded from history
	if c := del(t, ts, "/api/v1/messages/"+mid, aTok); c != 204 {
		t.Fatalf("delete: %d", c)
	}
	_, p := get(t, ts, "/api/v1/chats/"+chatID+"/messages", aTok)
	if len(p["messages"].([]any)) != 0 {
		t.Fatalf("deleted message still in history: %v", p)
	}
}

// ---- validation & edge cases (testing_agent) ----

func TestMessages_Validation(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	// empty: no text, no attachments
	if c, b := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		`{"clientNonce":"v1"}`, aTok); c != 400 || errCode(b) != "validation_failed" {
		t.Fatalf("empty: %d %v", c, b)
	}
	// no nonce
	if c, b := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		`{"text":"x"}`, aTok); c != 400 || errCode(b) != "validation_failed" {
		t.Fatalf("no nonce: %d %v", c, b)
	}
	// text over the 8192 contract cap
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"v2","text":%q}`, strings.Repeat("x", 8193)), aTok); c != 400 {
		t.Fatalf("overlong: %d", c)
	}
	// exactly 8192 passes
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"v3","text":%q}`, strings.Repeat("x", 8192)), aTok); c != 201 {
		t.Fatalf("8192 text rejected: %d", c)
	}
	// whitespace-only text is still "has text" — server stores verbatim
	if c, _ := send(t, ts, chatID, aTok, " "); c != 201 {
		t.Fatalf("space text: %d", c)
	}
}

func TestMessages_ReplyTo(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	other := directChat(t, ts, aTok, aID) // self-chat as second chat

	_, b := send(t, ts, chatID, aTok, "target")
	target := b["message"].(map[string]any)["id"].(string)
	_, ob := send(t, ts, other, aTok, "elsewhere")
	otherMsg := ob["message"].(map[string]any)["id"].(string)

	// legal reply in the same chat
	c, rb := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"r1","text":"re","replyToMessageId":%q}`, target), aTok)
	if c != 201 || rb["message"].(map[string]any)["replyToMessageId"] != target {
		t.Fatalf("reply: %d %v", c, rb)
	}
	// reply to a message in ANOTHER chat → 404
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"r2","text":"re","replyToMessageId":%q}`, otherMsg), aTok); c != 404 {
		t.Fatalf("cross-chat reply: %d", c)
	}
	// reply to a deleted message → 404 (tombstone is not replyable)
	if del(t, ts, "/api/v1/messages/"+target, aTok) != 204 {
		t.Fatal("setup delete")
	}
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"r3","text":"re","replyToMessageId":%q}`, target), aTok); c != 404 {
		t.Fatalf("reply to deleted: %d", c)
	}
}

func TestMessages_CursorEdges(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	for i := 1; i <= 5; i++ {
		send(t, ts, chatID, aTok, "m"+strconv.Itoa(i))
	}

	// after the newest → empty, no cursors
	_, p := get(t, ts, "/api/v1/chats/"+chatID+"/messages?after=5", aTok)
	if len(p["messages"].([]any)) != 0 || p["newerCursor"] != nil || p["nextCursor"] != nil {
		t.Fatalf("after tail: %v", p)
	}
	// before the oldest → empty
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?before=1", aTok)
	if len(p["messages"].([]any)) != 0 || p["nextCursor"] != nil {
		t.Fatalf("before head: %v", p)
	}
	// garbage cursor is opaque-ignored → behaves like tail page
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?before=garbage", aTok)
	if len(p["messages"].([]any)) != 5 {
		t.Fatalf("garbage cursor: %v", p)
	}
	// around an unknown id → window centered past the tail (mock parity)
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?around=00000000-0000-0000-0000-000000000000&limit=2", aTok)
	msgs := p["messages"].([]any)
	if len(msgs) != 1 || msgs[0].(map[string]any)["text"] != "m5" {
		t.Fatalf("around unknown: %v", msgs)
	}
	// limit beyond contract cap is clamped, not an error
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?limit=999", aTok)
	if len(p["messages"].([]any)) != 5 {
		t.Fatalf("limit clamp: %v", p)
	}
}

func TestMessages_DeletedTombstone(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	send(t, ts, chatID, aTok, "first")
	_, b := send(t, ts, chatID, aTok, "doomed secret")
	doomed := b["message"].(map[string]any)["id"].(string)

	if del(t, ts, "/api/v1/messages/"+doomed, aTok) != 204 {
		t.Fatal("delete")
	}
	// excluded from history and search
	_, p := get(t, ts, "/api/v1/chats/"+chatID+"/messages", aTok)
	if len(p["messages"].([]any)) != 1 {
		t.Fatalf("tombstone in history: %v", p)
	}
	_, p = get(t, ts, "/api/v1/chats/"+chatID+"/messages?q=secret", aTok)
	if len(p["messages"].([]any)) != 0 {
		t.Fatalf("tombstone in search: %v", p)
	}
	// chat summary falls back to the previous non-deleted message
	_, lb := get(t, ts, "/api/v1/chats", aTok)
	lm := lb["chats"].([]any)[0].(map[string]any)["lastMessage"].(map[string]any)
	if lm["text"] != "first" {
		t.Fatalf("lastMessage not rolled back: %v", lm)
	}
}

func TestChat_NotFoundMatrix(t *testing.T) {
	ts, _, _, aTok, _, _, _ := setupTwoUsers(t)
	ghost := "00000000-0000-0000-0000-000000000000"
	if c, _ := get(t, ts, "/api/v1/chats/"+ghost, aTok); c != 404 {
		t.Fatalf("getChat: %d", c)
	}
	if c, _ := get(t, ts, "/api/v1/chats/"+ghost+"/messages", aTok); c != 404 {
		t.Fatalf("listMessages: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/chats/"+ghost+"/read", `{"upToSeq":1}`, aTok); c != 404 {
		t.Fatalf("markRead: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/chats/"+ghost+"/pin", `{"pinned":true}`, aTok); c != 404 {
		t.Fatalf("setChatPinned: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/messages/"+ghost+"/pin", `{"pinned":true}`, aTok); c != 404 {
		t.Fatalf("pinMessage: %d", c)
	}
	if c, _ := patch(t, ts, "/api/v1/messages/"+ghost, `{"text":"x"}`, aTok); c != 404 {
		t.Fatalf("editMessage: %d", c)
	}
	if c := del(t, ts, "/api/v1/messages/"+ghost, aTok); c != 404 {
		t.Fatalf("deleteMessage: %d", c)
	}
}

func TestSelfChat_FullFlow(t *testing.T) {
	ts, _, _, aTok, aID, _, _ := setupTwoUsers(t)
	chatID := directChat(t, ts, aTok, aID)
	c, b := send(t, ts, chatID, aTok, "note to self")
	if c != 201 || b["message"].(map[string]any)["seq"].(float64) != 1 {
		t.Fatalf("self send: %d %v", c, b)
	}
	// own messages are never unread
	_, lb := get(t, ts, "/api/v1/chats", aTok)
	if lb["chats"].([]any)[0].(map[string]any)["unreadCount"].(float64) != 0 {
		t.Fatal("self-chat unread")
	}
}

// ---- mutual & authorization (security_agent) ----

func TestMutual_Lifecycle(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)

	// one-directional: a adds b — a sees mutual=false, b's list is empty
	c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	if c != 201 || b["contact"].(map[string]any)["mutual"] != false {
		t.Fatalf("one-way add: %d %v", c, b)
	}
	_, bl := get(t, ts, "/api/v1/contacts", bTok)
	if len(bl["contacts"].([]any)) != 0 {
		t.Fatalf("b must not see a's outgoing contact: %v", bl)
	}
	// neither direction can open a chat yet
	if c, _ := post(t, ts, "/api/v1/chats", fmt.Sprintf(`{"userId":%q}`, bID), aTok); c != 403 {
		t.Fatalf("a→b not mutual: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/chats", fmt.Sprintf(`{"userId":%q}`, aID), bTok); c != 403 {
		t.Fatalf("b→a not mutual: %d", c)
	}
	// mutual completes when b adds a back
	if c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, aID), bTok); c != 201 ||
		b["contact"].(map[string]any)["mutual"] != true {
		t.Fatalf("mutual leg: %d %v", c, b)
	}
	chatID := directChat(t, ts, aTok, bID)
	if c, _ := send(t, ts, chatID, aTok, "hello"); c != 201 {
		t.Fatalf("send in mutual chat: %d", c)
	}
	// b removes a → a's remaining contact loses mutual, but the chat persists
	if del(t, ts, "/api/v1/contacts/"+aID, bTok) != 204 {
		t.Fatal("b removes a")
	}
	_, al := get(t, ts, "/api/v1/contacts", aTok)
	if al["contacts"].([]any)[0].(map[string]any)["mutual"] != false {
		t.Fatalf("mutual flag did not reset: %v", al)
	}
	// membership is not revoked: existing chat keeps working for both
	if c, _ := send(t, ts, chatID, bTok, "still here"); c != 201 {
		t.Fatalf("post-removal send: %d", c)
	}
	if c, _ := get(t, ts, "/api/v1/chats/"+chatID, bTok); c != 200 {
		t.Fatalf("post-removal get: %d", c)
	}
}

func TestSecurity_ForeignMessageInvisible(t *testing.T) {
	ts, st, sender, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	cTok, _ := mkUser(t, ts, st, sender, "carol@x.io", "carol#0003")
	_, b := send(t, ts, chatID, aTok, "mine")
	mid := b["message"].(map[string]any)["id"].(string)

	// a stranger who somehow learned the message UUID must get 404 —
	// the message is invisible, not merely forbidden (existence leak)
	if c, _ := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"hax"}`, cTok); c != 404 {
		t.Fatalf("stranger edit must be 404, got %d", c)
	}
	if c := del(t, ts, "/api/v1/messages/"+mid, cTok); c != 404 {
		t.Fatalf("stranger delete must be 404, got %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/messages/"+mid+"/pin", `{"pinned":true}`, cTok); c != 404 {
		t.Fatalf("stranger pin must be 404, got %d", c)
	}
	// ...while a chat MEMBER editing a peer's message is a real 403
	if c, _ := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"hax"}`, bTok); c != 403 {
		t.Fatalf("member foreign edit must be 403, got %d", c)
	}
	if c := del(t, ts, "/api/v1/messages/"+mid, bTok); c != 403 {
		t.Fatalf("member foreign delete must be 403, got %d", c)
	}
	// and the attempts changed nothing
	_, p := get(t, ts, "/api/v1/chats/"+chatID+"/messages", aTok)
	m := p["messages"].([]any)[0].(map[string]any)
	if m["text"] != "mine" || m["pinned"] != false {
		t.Fatalf("message mutated by unauthorized calls: %v", m)
	}
}

func TestSecurity_MemberOnlyOps(t *testing.T) {
	ts, st, sender, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	cTok, _ := mkUser(t, ts, st, sender, "carol@x.io", "carol#0003")

	// every chat-scoped endpoint rejects a non-member with 404
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/pin", `{"pinned":true}`, cTok); c != 404 {
		t.Fatalf("foreign chat pin: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/chats/"+chatID+"/read", `{"upToSeq":99}`, cTok); c != 404 {
		t.Fatalf("foreign read marker: %d", c)
	}
	// unauthenticated → 401 on everything
	if c, _ := get(t, ts, "/api/v1/contacts", ""); c != 401 {
		t.Fatalf("contacts noauth: %d", c)
	}
	if c, _ := get(t, ts, "/api/v1/chats", ""); c != 401 {
		t.Fatalf("chats noauth: %d", c)
	}
}

func TestChatPin_Ordering(t *testing.T) {
	ts, st, sender, aTok, aID, bTok, bID := setupTwoUsers(t)
	cTok, cID := mkUser(t, ts, st, sender, "carol@x.io", "carol#0003")
	befriend(t, ts, aTok, bTok, aID, bID)
	befriend(t, ts, aTok, cTok, aID, cID)
	old := directChat(t, ts, aTok, bID)
	recent := directChat(t, ts, aTok, cID)

	send(t, ts, recent, aTok, "newer") // recent is active first by activity
	_, p := get(t, ts, "/api/v1/chats", aTok)
	chats := p["chats"].([]any)
	if chats[0].(map[string]any)["id"] != recent {
		t.Fatal("activity ordering wrong")
	}
	// pin older → it leads despite activity
	if c, _ := post(t, ts, "/api/v1/chats/"+old+"/pin", `{"pinned":true}`, aTok); c != 204 {
		t.Fatalf("pin: %d", c)
	}
	_, p = get(t, ts, "/api/v1/chats", aTok)
	chats = p["chats"].([]any)
	if chats[0].(map[string]any)["id"] != old {
		t.Fatalf("pinned ordering wrong: %v", chats)
	}
}
