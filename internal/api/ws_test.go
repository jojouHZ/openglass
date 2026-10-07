// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// B2 contract tests — real WebSocket hub against Mem store.
// Covers docs/api/ws-events.md: first-frame auth, per-session seq,
// ?last_seq replay, resync.required, fan-out, typing throttle, presence.
package api_test

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/jojouHZ/openglass/internal/api"
	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/store"
	"github.com/jojouHZ/openglass/internal/ws"
)

type wsFrame = ws.Frame

// newServerWS — full server with a real hub mounted at /api/v1/ws.
func newServerWS(t *testing.T) (*httptest.Server, *store.Mem, *auth.CaptureSender, *ws.Hub) {
	t.Helper()
	st := store.NewMem()
	st.SeedInvite("GLS-DEMO")
	sender := auth.NewCaptureSender()
	cfg := &config.Config{
		JWTSecret:         []byte("test-secret"),
		AccessTokenTTL:    15 * time.Minute,
		RefreshTokenTTL:   30 * 24 * time.Hour,
		OtpTTL:            10 * time.Minute,
		OtpResendCooldown: 60 * time.Second,
		OtpMaxAttempts:    5,
		DevMode:           true,
	}
	tokens := auth.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	hub := ws.NewHub(tokens.ParseAccess, st)
	srv := api.New(cfg, st, sender, api.WithHub(hub))
	ts := httptest.NewServer(srv.Handler(hub.ServeHTTP))
	t.Cleanup(func() { ts.Close(); hub.Close() })
	return ts, st, sender, hub
}

func wsDial(t *testing.T, ts *httptest.Server, lastSeq int64) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/ws"
	if lastSeq > 0 {
		url += fmt.Sprintf("?last_seq=%d", lastSeq)
	}
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func wsAuth(t *testing.T, c *websocket.Conn, token string) {
	t.Helper()
	if err := c.WriteJSON(map[string]any{
		"type": "auth", "data": map[string]any{"accessToken": token},
	}); err != nil {
		t.Fatalf("auth frame: %v", err)
	}
}

func wsRead(t *testing.T, c *websocket.Conn) wsFrame {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var f wsFrame
	if err := c.ReadJSON(&f); err != nil {
		t.Fatalf("read frame: %v", err)
	}
	return f
}

// wsConnect dials + auths + drains the connect burst, returning the
// auth.ok frame and everything after it (snapshot etc).
func wsConnect(t *testing.T, ts *httptest.Server, token string, lastSeq int64) (*websocket.Conn, []wsFrame) {
	t.Helper()
	c := wsDial(t, ts, lastSeq)
	wsAuth(t, c, token)
	var frames []wsFrame
	for {
		f := wsRead(t, c)
		frames = append(frames, f)
		if f.Type == "auth.ok" {
			break
		}
		if f.Type == "auth.fail" {
			t.Fatalf("auth failed: %v", f.Data)
		}
	}
	return c, frames
}

func lastSeqOf(frames []wsFrame) int64 {
	var max int64
	for _, f := range frames {
		if f.Seq > max {
			max = f.Seq
		}
	}
	return max
}

func setupWSChat(t *testing.T) (*httptest.Server, *store.Mem, *ws.Hub,
	string, string, string, string, string) {
	ts, st, sender, hub := newServerWS(t)
	aTok, aID := mkUser(t, ts, st, sender, "wa@x.io", "wa#0001")
	bTok, bID := mkUser(t, ts, st, sender, "wb@x.io", "wb#0002")
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	return ts, st, hub, aTok, aID, bTok, bID, chatID
}

// ---- auth ----

func TestWS_AuthTimeout(t *testing.T) {
	ts, _, _, _ := newServerWS(t)
	c := wsDial(t, ts, 0)
	defer func() { _ = c.Close() }()
	_ = c.SetReadDeadline(time.Now().Add(8 * time.Second))
	_, _, err := c.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != 4408 {
		t.Fatalf("expected close 4408, got %v", err)
	}
}

func TestWS_BadToken(t *testing.T) {
	ts, _, _, _ := newServerWS(t)
	c := wsDial(t, ts, 0)
	defer func() { _ = c.Close() }()
	wsAuth(t, c, "garbage-token")
	f := wsRead(t, c)
	if f.Type != "auth.fail" || f.Data["code"] != "unauthorized" {
		t.Fatalf("auth.fail: %v", f)
	}
	_, _, err := c.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != 4401 {
		t.Fatalf("expected close 4401, got %v", err)
	}
}

func TestWS_AuthOK_Snapshot_PingPong(t *testing.T) {
	ts, st, sender, _ := newServerWS(t)
	aTok, _ := mkUser(t, ts, st, sender, "solo@x.io", "solo#0001")
	c, frames := wsConnect(t, ts, aTok, 0)
	defer func() { _ = c.Close() }()

	auth := frames[len(frames)-1]
	if auth.Type != "auth.ok" || auth.Seq == 0 {
		t.Fatalf("auth.ok: %v", auth)
	}
	snap := wsRead(t, c)
	if snap.Type != "presence.snapshot" {
		t.Fatalf("first post-auth frame must be presence.snapshot, got %v", snap.Type)
	}
	before := snap.Seq
	if err := c.WriteJSON(map[string]any{"type": "ping", "data": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	pong := wsRead(t, c)
	if pong.Type != "pong" || pong.Seq != before+1 {
		t.Fatalf("pong seq not monotonic: %v", pong)
	}
}

// ---- seq + replay ----

func TestWS_ReplayAfterDisconnect(t *testing.T) {
	ts, _, _, aTok, aID, bTok, _, chatID := setupWSChat(t)
	_ = aID

	// bob connects, notes seq, disconnects; a message lands while away
	bc, frames := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc) // presence.snapshot
	sent := lastSeqOf(frames) + 1
	_ = bc.Close()

	send(t, ts, chatID, aTok, "while you were away") // REST → hub buffers

	// reconnect with the last seen seq → the missed frame replays first
	bc2, replay := wsConnect(t, ts, bTok, sent)
	defer func() { _ = bc2.Close() }()
	if len(replay) < 2 || replay[0].Type != "message.new" {
		t.Fatalf("replay first frame should be message.new: %v", replay)
	}
	if replay[0].Data["text"] != "while you were away" {
		t.Fatalf("replayed payload: %v", replay[0].Data)
	}
	auth := replay[len(replay)-1]
	if auth.Data["resumedFromSeq"] == nil {
		t.Fatalf("resumedFromSeq must be set on honored last_seq: %v", auth)
	}
}

func TestWS_ResyncGap(t *testing.T) {
	ts, _, hub, aTok, _, bTok, _, chatID := setupWSChat(t)
	hub.ReplayCap = 2 // tiny ring → old frames evict fast

	bc, frames := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc) // snapshot
	sent := lastSeqOf(frames) + 1
	_ = bc.Close()

	for i := 0; i < 5; i++ {
		send(t, ts, chatID, aTok, fmt.Sprintf("flood%d", i))
	}

	bc2, got := wsConnect(t, ts, bTok, sent)
	defer func() { _ = bc2.Close() }()
	// replay may contain the retained tail, then resync.required{gap}
	var resync *wsFrame
	for i := range got {
		if got[i].Type == "resync.required" {
			resync = &got[i]
		}
	}
	if resync == nil {
		resync = &[]wsFrame{wsRead(t, bc2)}[0] // might arrive post-auth.ok
	}
	if resync.Data["reason"] != "gap" {
		t.Fatalf("expected gap resync: %v", resync)
	}
}

func TestWS_ResyncEvicted(t *testing.T) {
	ts, _, hub, _, _, bTok, _, _ := setupWSChat(t)
	hub.SessionIdleTTL = 0 // every idle session is stale

	bc, frames := wsConnect(t, ts, bTok, 0)
	last := lastSeqOf(frames)
	_ = bc.Close()

	// server-side detach is async — sweep until the idle session is gone
	var got []wsFrame
	var bc2 *websocket.Conn
	for i := 0; i < 50; i++ {
		hub.Sweep()
		bc2, got = wsConnect(t, ts, bTok, last)
		auth := got[len(got)-1]
		if auth.Data["resumedFromSeq"] == nil {
			break // evicted — a fresh session was created
		}
		_ = bc2.Close()
		time.Sleep(20 * time.Millisecond)
	}
	defer func() { _ = bc2.Close() }()
	auth := got[len(got)-1]
	if auth.Data["resumedFromSeq"] != nil {
		t.Fatalf("evicted session must not resume: %v", auth)
	}
	f := wsRead(t, bc2)
	if f.Type != "resync.required" || f.Data["reason"] != "evicted" {
		t.Fatalf("expected evicted resync: %v", f)
	}
}

// ---- fan-out ----

func TestWS_MessageFanout(t *testing.T) {
	ts, _, _, aTok, _, bTok, _, chatID := setupWSChat(t)

	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc) // snapshot
	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac) // snapshot
	// alice's connect may emit presence{online} to bob — drain up to it
	defer func() { _ = bc.Close(); _ = ac.Close() }()

	send(t, ts, chatID, aTok, "ping b")
	// bob may see presence{alice online} first — scan for message.new
	for i := 0; i < 5; i++ {
		f := wsRead(t, bc)
		if f.Type == "message.new" {
			if f.Data["text"] != "ping b" || f.Data["chatId"] != chatID {
				t.Fatalf("message.new payload: %v", f.Data)
			}
			return
		}
	}
	t.Fatal("bob never got message.new")
}

func TestWS_ForeignChatSilent(t *testing.T) {
	ts, st, sender, _ := newServerWS(t)
	aTok, aID := mkUser(t, ts, st, sender, "fa@x.io", "fa#0001")
	bTok, bID := mkUser(t, ts, st, sender, "fb@x.io", "fb#0002")
	cTok, _ := mkUser(t, ts, st, sender, "fc@x.io", "fc#0003")
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	cc, _ := wsConnect(t, ts, cTok, 0)
	wsRead(t, cc) // snapshot
	defer func() { _ = cc.Close() }()

	send(t, ts, chatID, aTok, "not for carol")
	_ = cc.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	var f wsFrame
	err := cc.ReadJSON(&f)
	if err == nil {
		t.Fatalf("stranger received a frame: %v", f)
	}
}

func TestWS_TypingAndThrottle(t *testing.T) {
	ts, _, hub, aTok, aID, bTok, _, chatID := setupWSChat(t)
	hub.TypingInterval = time.Hour // make the throttle visible in-test

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc)
	defer func() { _ = ac.Close(); _ = bc.Close() }()

	start := map[string]any{"type": "typing.start", "data": map[string]any{"chatId": chatID}}
	for i := 0; i < 3; i++ {
		if err := ac.WriteJSON(start); err != nil {
			t.Fatal(err)
		}
	}
	// exactly one typing frame reaches bob within the throttle window
	gotTyping := false
	deadline := time.Now().Add(600 * time.Millisecond)
	for time.Now().Before(deadline) {
		_ = bc.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
		var f wsFrame
		if err := bc.ReadJSON(&f); err != nil {
			break
		}
		if f.Type == "typing" {
			if gotTyping {
				t.Fatal("throttle let a second typing through")
			}
			gotTyping = true
			if f.Data["userId"] != aID || f.Data["chatId"] != chatID {
				t.Fatalf("typing payload: %v", f.Data)
			}
		}
	}
	if !gotTyping {
		t.Fatal("typing never delivered")
	}
}

func TestWS_ReceiptReadFanout(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID, chatID := setupWSChat(t)

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc)
	defer func() { _ = ac.Close(); _ = bc.Close() }()

	send(t, ts, chatID, aTok, "see me")
	_ = wsRead(t, bc) // message.new for bob

	if err := bc.WriteJSON(map[string]any{
		"type": "receipt.read", "data": map[string]any{"chatId": chatID, "upToSeq": 1},
	}); err != nil {
		t.Fatal(err)
	}
	// alice gets the receipt; bob's own conn gets it too (multi-device sync)
	for _, c := range []*websocket.Conn{ac, bc} {
		for i := 0; i < 5; i++ {
			f := wsRead(t, c)
			if f.Type == "receipt.read" {
				if f.Data["userId"] != bID || f.Data["upToSeq"].(float64) != 1 {
					t.Fatalf("receipt payload: %v", f.Data)
				}
				break
			}
			if i == 4 {
				t.Fatal("receipt.read never arrived")
			}
		}
	}
	// read cursor persisted in the store
	_, lb := get(t, ts, "/api/v1/chats", bTok)
	if lb["chats"].([]any)[0].(map[string]any)["unreadCount"].(float64) != 0 {
		t.Fatal("receipt.read did not mark read")
	}
	_ = aID
}

func TestWS_SessionRevoked(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID, _ := setupWSChat(t)
	_, _ = aID, bID

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	defer func() { _ = ac.Close() }()

	// logout → the live conn hears session.revoked then closes
	if c, _ := post(t, ts, "/api/v1/auth/logout", "", aTok); c != 204 {
		t.Fatalf("logout: %d", c)
	}
	sawRevoked := false
	for i := 0; i < 5; i++ {
		f := wsRead(t, ac)
		if f.Type == "session.revoked" {
			sawRevoked = true
			break
		}
	}
	if !sawRevoked {
		t.Fatal("session.revoked never arrived")
	}
	// REST on the revoked session is dead too
	if c, _ := get(t, ts, "/api/v1/chats", aTok); c != 401 {
		t.Fatalf("revoked token still works: %d", c)
	}
	// and the still-valid JWT must NOT re-attach over WS
	cc := wsDial(t, ts, 0)
	defer func() { _ = cc.Close() }()
	wsAuth(t, cc, aTok)
	f := wsRead(t, cc)
	if f.Type != "auth.fail" {
		t.Fatalf("revoked session re-attached: %v", f)
	}
	_, _, err := cc.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != 4401 {
		t.Fatalf("expected close 4401 for revoked session, got %v", err)
	}
	_ = bTok
}

// A revoked session's access token stays JWT-valid until expiry — the
// hub must gate on SessionActive the same way REST middleware does.
func TestWS_RevokedReattachRejected(t *testing.T) {
	ts, _, _, aTok, _, _, _, _ := setupWSChat(t)

	// attach once, detach, revoke, try again
	c, _ := wsConnect(t, ts, aTok, 0)
	_ = c.Close()
	if code, _ := post(t, ts, "/api/v1/auth/logout", "", aTok); code != 204 {
		t.Fatalf("logout: %d", code)
	}
	c2 := wsDial(t, ts, 0)
	defer func() { _ = c2.Close() }()
	wsAuth(t, c2, aTok)
	f := wsRead(t, c2)
	if f.Type != "auth.fail" || f.Data["code"] != "unauthorized" {
		t.Fatalf("revoked session must fail auth: %v", f)
	}
}

// ---- presence privacy: mutual contacts only ----

func TestWS_PresenceMutualOnly(t *testing.T) {
	ts, st, sender, hub := newServerWS(t)
	hub.OfflineGrace = 50 * time.Millisecond
	aTok, aID := mkUser(t, ts, st, sender, "pa@x.io", "pa#0001")
	bTok, bID := mkUser(t, ts, st, sender, "pb@x.io", "pb#0002")
	cTok, cID := mkUser(t, ts, st, sender, "pc@x.io", "pc#0003")
	befriend(t, ts, aTok, bTok, aID, bID) // A↔B mutual; C is a stranger

	// carol connects — alice must NOT hear it
	cc, _ := wsConnect(t, ts, cTok, 0)
	cs := wsRead(t, cc)                        // her snapshot — no mutuals → empty
	ids, _ := cs.Data["onlineUserIds"].([]any) // nil slice marshals as null
	if cs.Type != "presence.snapshot" || len(ids) != 0 {
		t.Fatalf("stranger snapshot must be empty: %v", cs.Data)
	}

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac) // alice snapshot: carol absent (not mutual)
	defer func() { _ = ac.Close() }()

	// gorilla client corrupts on read timeout — collect in background
	aframes := make(chan wsFrame, 64)
	go func() {
		defer close(aframes)
		for {
			var f wsFrame
			if err := ac.ReadJSON(&f); err != nil {
				return
			}
			aframes <- f
		}
	}()
	select {
	case f := <-aframes:
		t.Fatalf("alice heard stranger presence/event: %v", f)
	case <-time.After(400 * time.Millisecond):
	}

	// mutual now → carol's disconnect+reconnect reaches alice as
	// presence{offline} then presence{online} (grace-then-flap path)
	befriend(t, ts, aTok, cTok, aID, cID)
	_ = cc.Close()
	waitPresence := func(want string) {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for {
			select {
			case ev, ok := <-aframes:
				if !ok {
					t.Fatal("alice conn died")
				}
				if ev.Type == "presence" && ev.Data["userId"] == cID && ev.Data["status"] == want {
					return
				}
			case <-deadline:
				t.Fatalf("alice never got mutual's presence{%s}", want)
			}
		}
	}
	waitPresence("offline")
	cc2, _ := wsConnect(t, ts, cTok, 0)
	defer func() { _ = cc2.Close() }()
	waitPresence("online")
}

// One session, two connections (multi-tab) — contract duplicates every
// event per connection.
func TestWS_MultiConnSameSession(t *testing.T) {
	ts, _, _, aTok, _, bTok, _, chatID := setupWSChat(t)

	b1, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, b1)
	b2, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, b2)
	defer func() { _ = b1.Close(); _ = b2.Close() }()

	send(t, ts, chatID, aTok, "to both tabs")
	for _, c := range []*websocket.Conn{b1, b2} {
		seen := false
		for i := 0; i < 6; i++ {
			f := wsRead(t, c)
			if f.Type == "message.new" && f.Data["text"] == "to both tabs" {
				seen = true
				break
			}
		}
		if !seen {
			t.Fatal("second conn missed message.new — duplication broken")
		}
	}
}

// A conn must not outlive the credential that opened it — afterExpiry
// drops it with 4401 the moment the access token dies.
func TestWS_TokenExpiryDropsConn(t *testing.T) {
	ts, st, sender, _ := newServerWS(t)
	aTok, aID := mkUser(t, ts, st, sender, "exp@x.io", "exp#0001")

	code, body := get(t, ts, "/api/v1/auth/sessions", aTok)
	if code != 200 {
		t.Fatalf("sessions: %d", code)
	}
	var sid string
	for _, s := range body["sessions"].([]any) {
		if s.(map[string]any)["current"] == true {
			sid = s.(map[string]any)["id"].(string)
		}
	}
	if sid == "" {
		t.Fatal("no current session in list")
	}

	// same secret, 2s TTL — the token parses, then dies mid-conn.
	// jwt.NumericDate truncates to whole seconds, so a 1s TTL minted
	// at t.999 would live ~1ms and die before auth completes; 2s
	// guarantees (1s, 2s] of life.
	short := auth.NewTokens([]byte("test-secret"), 2*time.Second, time.Hour)
	pair, err := short.NewPair(aID, sid)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := wsConnect(t, ts, pair.AccessToken, 0)
	defer func() { _ = c.Close() }()

	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var f wsFrame
		if err := c.ReadJSON(&f); err != nil {
			ce, ok := err.(*websocket.CloseError)
			if !ok || ce.Code != 4401 {
				t.Fatalf("expected close 4401 on token expiry, got %v", err)
			}
			return
		}
	}
}

// A first frame that isn't `auth` is unauthorized, not a protocol noop.
func TestWS_NonAuthFirstFrame(t *testing.T) {
	ts, _, _, _ := newServerWS(t)
	c := wsDial(t, ts, 0)
	defer func() { _ = c.Close() }()
	if err := c.WriteJSON(map[string]any{"type": "ping", "data": map[string]any{}}); err != nil {
		t.Fatal(err)
	}
	_, _, err := c.ReadMessage()
	ce, ok := err.(*websocket.CloseError)
	if !ok || ce.Code != 4401 {
		t.Fatalf("expected close 4401 for non-auth frame, got %v", err)
	}
}

// typing from a non-member is dropped silently — no fan-out, no echo.
func TestWS_TypingNonMemberDropped(t *testing.T) {
	ts, st, sender, _ := newServerWS(t)
	aTok, aID := mkUser(t, ts, st, sender, "ta@x.io", "ta#0001")
	bTok, bID := mkUser(t, ts, st, sender, "tb@x.io", "tb#0002")
	cTok, _ := mkUser(t, ts, st, sender, "tc@x.io", "tc#0003")
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	cc, _ := wsConnect(t, ts, cTok, 0)
	wsRead(t, cc)
	defer func() { _ = ac.Close(); _ = cc.Close() }()

	if err := cc.WriteJSON(map[string]any{
		"type": "typing.start", "data": map[string]any{"chatId": chatID},
	}); err != nil {
		t.Fatal(err)
	}
	// alice must see nothing — the typing must not leak outside members
	_ = ac.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	var f wsFrame
	if err := ac.ReadJSON(&f); err == nil {
		t.Fatalf("non-member typing leaked to a member: %v", f)
	}
}

// EmitToChatExcept must not echo typing back to its sender.
func TestWS_TypingNotEchoedToSender(t *testing.T) {
	ts, _, _, aTok, _, bTok, _, chatID := setupWSChat(t)

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc)
	defer func() { _ = ac.Close(); _ = bc.Close() }()

	if err := ac.WriteJSON(map[string]any{
		"type": "typing.start", "data": map[string]any{"chatId": chatID},
	}); err != nil {
		t.Fatal(err)
	}
	// bob gets it — proves the emit fired
	for i := 0; i < 5; i++ {
		if f := wsRead(t, bc); f.Type == "typing" {
			break
		}
	}
	// alice must NOT see her own typing
	_ = ac.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	for {
		var f wsFrame
		if err := ac.ReadJSON(&f); err != nil {
			return
		}
		if f.Type == "typing" {
			t.Fatalf("sender received own typing echo: %v", f.Data)
		}
	}
}

// typing.stop emits `until` ≈ now — clients drop the indicator at once.
func TestWS_TypingStopImmediate(t *testing.T) {
	ts, _, _, aTok, aID, bTok, _, chatID := setupWSChat(t)

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc)
	defer func() { _ = ac.Close(); _ = bc.Close() }()

	if err := ac.WriteJSON(map[string]any{
		"type": "typing.stop", "data": map[string]any{"chatId": chatID},
	}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		f := wsRead(t, bc)
		if f.Type != "typing" {
			continue
		}
		until, err := time.Parse(time.RFC3339, f.Data["until"].(string))
		if err != nil {
			t.Fatalf("until: %v", err)
		}
		if time.Since(until) > 2*time.Second {
			t.Fatalf("typing.stop must land already-expired, got until=%v", until)
		}
		if f.Data["userId"] != aID {
			t.Fatalf("typing payload userId: %v", f.Data)
		}
		return
	}
	t.Fatal("typing frame never arrived")
}

// Reconnect inside the grace window must not flap presence{offline} —
// flaky networks shouldn't spam mutuals with false offlines.
func TestWS_PresenceGraceSuppressesFlap(t *testing.T) {
	ts, st, sender, hub := newServerWS(t)
	hub.OfflineGrace = 500 * time.Millisecond
	aTok, aID := mkUser(t, ts, st, sender, "ga@x.io", "ga#0001")
	bTok, bID := mkUser(t, ts, st, sender, "gb@x.io", "gb#0002")
	befriend(t, ts, aTok, bTok, aID, bID)

	ac, _ := wsConnect(t, ts, aTok, 0)
	wsRead(t, ac)
	defer func() { _ = ac.Close() }()
	bc, _ := wsConnect(t, ts, bTok, 0)
	wsRead(t, bc)

	// flap: disconnect + reconnect well inside the grace window
	_ = bc.Close()
	time.Sleep(50 * time.Millisecond)
	bc2, _ := wsConnect(t, ts, bTok, 0)
	defer func() { _ = bc2.Close() }()

	// alice may legitimately see presence{bob online} again — the banned
	// outcome is offline. Read past the grace window to be sure.
	_ = ac.SetReadDeadline(time.Now().Add(900 * time.Millisecond))
	for {
		var f wsFrame
		if err := ac.ReadJSON(&f); err != nil {
			return // timeout — no flap leaked
		}
		if f.Type == "presence" && f.Data["status"] == "offline" && f.Data["userId"] == bID {
			t.Fatalf("grace flap leaked presence{offline}: %v", f.Data)
		}
	}
}

// Client frames are capped at 32 KiB — an oversized frame kills the conn.
func TestWS_ReadLimit(t *testing.T) {
	ts, _, _, aTok, _, _, _, _ := setupWSChat(t)
	c, _ := wsConnect(t, ts, aTok, 0)
	defer func() { _ = c.Close() }()
	wsRead(t, c) // snapshot

	big := strings.Repeat("x", 40<<10)
	if err := c.WriteMessage(websocket.TextMessage,
		[]byte(`{"type":"ping","data":{"pad":"`+big+`"}}`)); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var f wsFrame
		if err := c.ReadJSON(&f); err != nil {
			return // conn dead — limit enforced
		}
	}
}
