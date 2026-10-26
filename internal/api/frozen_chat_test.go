// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// F1.2 — consent outlives the chat: a direct chat whose pair stopped being
// contacts is a read-only archive (no send, edit, pin, typing); the author
// can still retract. Edits are limited to a short window after sending.
package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jojouHZ/openglass/internal/api"
	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/store"
)

func TestFrozenChat_BlocksEditPinAndKeepsRetract(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	_, b := send(t, ts, chatID, aTok, "terms: 100")
	mid := b["message"].(map[string]any)["id"].(string)

	// while contacts, editing inside the window and pinning work
	if c, _ := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"terms: 120"}`, aTok); c != 200 {
		t.Fatalf("edit inside the window: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/messages/"+mid+"/pin", `{"pinned":true}`, bTok); c != 200 {
		t.Fatalf("pin while contacts: %d", c)
	}

	del(t, ts, "/api/v1/contacts/"+aID, bTok) // b ends the contact

	if c, e := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"terms: 999"}`, aTok); c != 403 || errCode(e) != "forbidden" {
		t.Fatalf("edit in a frozen chat: %d %v", c, e)
	}
	for _, tok := range []string{aTok, bTok} {
		if c, e := post(t, ts, "/api/v1/messages/"+mid+"/pin", `{"pinned":false}`, tok); c != 403 {
			t.Fatalf("pin in a frozen chat: %d %v", c, e)
		}
	}
	// the author may still retract their own message
	if c := del(t, ts, "/api/v1/messages/"+mid, aTok); c != 204 {
		t.Fatalf("retract in a frozen chat: %d", c)
	}
}

func TestEditWindow_ClosesAfterTheConfiguredTime(t *testing.T) {
	st := store.NewMem()
	st.SeedInvite("GLS-DEMO")
	sender := auth.NewCaptureSender()
	cfg := &config.Config{
		JWTSecret: []byte("test-secret"), AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour,
		OtpTTL: 10 * time.Minute, OtpResendCooldown: time.Minute, OtpMaxAttempts: 5, DevMode: true,
		UploadsDir: t.TempDir(),
	}
	srv := api.New(cfg, st, sender, api.WithEditWindow(150*time.Millisecond))
	ts := httptest.NewServer(srv.Handler(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUpgradeRequired) }))
	defer ts.Close()
	aTok, aID := mkUser(t, ts, st, sender, "ew-a@x.io", "ewa#0001")
	bTok, bID := mkUser(t, ts, st, sender, "ew-b@x.io", "ewb#0002")
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	_, b := send(t, ts, chatID, aTok, "first")
	mid := b["message"].(map[string]any)["id"].(string)

	if c, _ := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"first!"}`, aTok); c != 200 {
		t.Fatalf("inside the window: %d", c)
	}
	time.Sleep(250 * time.Millisecond)
	c, e := patch(t, ts, "/api/v1/messages/"+mid, `{"text":"rewritten"}`, aTok)
	if c != 403 || errCode(e) != "forbidden" {
		t.Fatalf("after the window: %d %v", c, e)
	}
	if d := e["error"].(map[string]any)["details"].(map[string]any); d["reason"] != "edit_window_closed" {
		t.Fatalf("details: %v", d)
	}
	// retract is not time-limited
	if c := del(t, ts, "/api/v1/messages/"+mid, aTok); c != 204 {
		t.Fatalf("delete after the window: %d", c)
	}
}

func TestWS_TypingStopsWhenThePairIsGone(t *testing.T) {
	ts, _, hub, aTok, aID, bTok, bID, chatID := setupWSChat(t)
	hub.TypingInterval = time.Millisecond

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc)
	defer func() { _ = ac.Close(); _ = bc.Close() }()

	typing := map[string]any{"type": "typing.start", "data": map[string]any{"chatId": chatID}}
	_ = ac.WriteJSON(typing)
	for i := 0; i < 6; i++ { // control: contacts → bob sees typing
		if wsRead(t, bc).Type == "typing" {
			goto frozen
		}
	}
	t.Fatal("typing never reached the peer while contacts")

frozen:
	del(t, ts, "/api/v1/contacts/"+bID, aTok)
	time.Sleep(20 * time.Millisecond)
	// drain the contact.removed frame, then type again
	_ = bc.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	for {
		var f wsFrame
		if err := bc.ReadJSON(&f); err != nil {
			break
		}
	}
	_ = ac.WriteJSON(typing)
	_ = bc.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	var f wsFrame
	if err := bc.ReadJSON(&f); err == nil && f.Type == "typing" {
		t.Fatalf("typing leaked through a frozen chat: %v", f)
	}
	_ = aID
}
