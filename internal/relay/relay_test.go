// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package relay

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/jojouHZ/openglass/internal/store"
)

// stub validator: token "tok-<user>-<sess>" → (user, sess, +1h, nil).
// user ids contain dashes (uuids); the session part is after the LAST dash.
func validate(token string) (userID, sessionID string, exp time.Time, err error) {
	rest, ok := strings.CutPrefix(token, "tok-")
	if !ok {
		return "", "", time.Time{}, errors.New("bad token")
	}
	i := strings.LastIndex(rest, "-")
	if i <= 0 || i == len(rest)-1 {
		return "", "", time.Time{}, errors.New("bad token")
	}
	return rest[:i], rest[i+1:], time.Now().Add(time.Hour), nil
}

type wsFrame struct {
	Type string         `json:"type"`
	Data map[string]any `json:"data"`
}

// testDir wraps Mem and stubs SessionActive — tests use fake session ids
// ("sa", "sb") that never exist in the store's session table.
type testDir struct{ *store.Mem }

func (testDir) SessionActive(context.Context, string) (bool, error) { return true, nil }

func newTestRelay(t *testing.T) (*httptest.Server, *store.Mem, *Relay) {
	t.Helper()
	st := store.NewMem()
	rl := New(validate, testDir{st})
	rl.PeerGrace = 300 * time.Millisecond
	rl.InviteTTL = 400 * time.Millisecond
	rl.MinTTL = time.Second
	ts := httptest.NewServer(rl)
	t.Cleanup(func() { ts.Close(); rl.Close() })
	return ts, st, rl
}

func mkUser(t *testing.T, st *store.Mem, email string) *store.User {
	t.Helper()
	u, err := st.CreateUser(context.Background(), email)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func befriend(t *testing.T, st *store.Mem, a, b *store.User) {
	t.Helper()
	ctx := context.Background()
	if _, err := st.AddContact(ctx, a.ID, b.ID); err != nil {
		t.Fatalf("add contact a→b: %v", err)
	}
	if _, err := st.AddContact(ctx, b.ID, a.ID); err != nil {
		t.Fatalf("add contact b→a: %v", err)
	}
}

func dial(t *testing.T, ts *httptest.Server) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(ts.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func read(t *testing.T, c *websocket.Conn) wsFrame {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var f wsFrame
	if err := c.ReadJSON(&f); err != nil {
		t.Fatalf("read: %v", err)
	}
	return f
}

// connect dials + auths + consumes auth.ok; returns the conn plus any
// known-session frames emitted right after auth.ok is read lazily by tests.
func connect(t *testing.T, ts *httptest.Server, user, sess string) *websocket.Conn {
	t.Helper()
	c := dial(t, ts)
	if err := c.WriteJSON(map[string]any{
		"type": "auth", "data": map[string]any{"accessToken": "tok-" + user + "-" + sess},
	}); err != nil {
		t.Fatalf("auth write: %v", err)
	}
	f := read(t, c)
	if f.Type != "auth.ok" {
		t.Fatalf("want auth.ok, got %v", f)
	}
	return c
}

func send(t *testing.T, c *websocket.Conn, typ string, data map[string]any) {
	t.Helper()
	if err := c.WriteJSON(map[string]any{"type": typ, "data": data}); err != nil {
		t.Fatalf("send %s: %v", typ, err)
	}
}

// invite establishes a pending session: a invites b (already-connected),
// returns the sessionId from b's relay.invite frame.
func invite(t *testing.T, a, b *websocket.Conn, bID string, extra map[string]any) string {
	t.Helper()
	d := map[string]any{"toUserId": bID, "ttlSeconds": 120}
	for k, v := range extra {
		d[k] = v
	}
	send(t, a, "relay.invite", d)
	f := read(t, b)
	if f.Type != "relay.invite" {
		t.Fatalf("want relay.invite at b, got %v", f)
	}
	sid, _ := f.Data["sessionId"].(string)
	if sid == "" {
		t.Fatalf("invite missing sessionId: %v", f.Data)
	}
	return sid
}

// establish completes accept → drains both relay.established frames.
func establish(t *testing.T, a, b *websocket.Conn, sid string) {
	t.Helper()
	send(t, b, "relay.accept", map[string]any{"sessionId": sid})
	fa, fb := read(t, a), read(t, b)
	if fa.Type != "relay.established" || fb.Type != "relay.established" {
		t.Fatalf("want relay.established ×2, got %v / %v", fa, fb)
	}
	if fa.Data["resumeToken"] == nil || fb.Data["resumeToken"] == nil {
		t.Fatalf("established must carry per-side resumeToken: %v / %v", fa, fb)
	}
}

func TestRelay_NonAuthFirstFrame(t *testing.T) {
	ts, _, _ := newTestRelay(t)
	c := dial(t, ts)
	defer func() { _ = c.Close() }()
	send(t, c, "ping", map[string]any{})
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err := c.ReadMessage()
	if err == nil {
		t.Fatal("expected close for non-auth first frame")
	}
}

func TestRelay_BadToken(t *testing.T) {
	ts, _, _ := newTestRelay(t)
	c := dial(t, ts)
	defer func() { _ = c.Close() }()
	send(t, c, "auth", map[string]any{"accessToken": "garbage"})
	f := read(t, c)
	if f.Type != "auth.fail" {
		t.Fatalf("want auth.fail, got %v", f)
	}
}

func TestRelay_InviteAcceptSend(t *testing.T) {
	ts, st, _ := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()
	defer func() { _ = cb.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil)
	establish(t, ca, cb, sid)

	send(t, ca, "relay.send", map[string]any{"sessionId": sid, "blob": "a2VuLWtleQ=="})
	f := read(t, cb)
	if f.Type != "relay.msg" || f.Data["blob"] != "a2VuLWtleQ==" || f.Data["msgSeq"] != float64(1) {
		t.Fatalf("want relay.msg seq=1, got %v", f)
	}
	send(t, cb, "relay.send", map[string]any{"sessionId": sid, "blob": "cmVwbHk="})
	f = read(t, ca)
	if f.Type != "relay.msg" || f.Data["msgSeq"] != float64(2) {
		t.Fatalf("want relay.msg seq=2, got %v", f)
	}
}

func TestRelay_InviteNonMutualRejected(t *testing.T) {
	ts, st, _ := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	// no contacts — not mutual
	ca := connect(t, ts, ua.ID, "sa")
	defer func() { _ = ca.Close() }()
	send(t, ca, "relay.invite", map[string]any{"toUserId": ub.ID, "ttlSeconds": 120})
	f := read(t, ca)
	if f.Type != "relay.error" || f.Data["code"] != "not_participant" {
		t.Fatalf("want relay.error not_participant, got %v", f)
	}
}

func TestRelay_OfflineBuffersThenResumeFlushes(t *testing.T) {
	ts, st, _ := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil)
	establish(t, ca, cb, sid)
	resumeTok := ""
	// re-read b's established? we drained it in establish; token lives in
	// the frame data — grab it via a second conn trick is brittle, so
	// establish() already drained it. Re-derive: emitKnownSessions re-sends
	// established on every auth, so reconnecting b sees it fresh.
	_ = resumeTok

	_ = cb.Close() // b goes offline → a hears peer-offline
	f := read(t, ca)
	if f.Type != "relay.peer-offline" {
		t.Fatalf("want peer-offline, got %v", f)
	}

	send(t, ca, "relay.send", map[string]any{"sessionId": sid, "blob": "bG9n"})
	send(t, ca, "relay.send", map[string]any{"sessionId": sid, "blob": "Ym9n"})

	cb = connect(t, ts, ub.ID, "sb") // reconnect — auth.ok, then re-emitted established
	defer func() { _ = cb.Close() }()
	f = read(t, cb)
	if f.Type != "relay.established" {
		t.Fatalf("want re-emitted established, got %v", f)
	}
	send(t, cb, "relay.resume", map[string]any{
		"sessionId": sid, "resumeToken": f.Data["resumeToken"]})
	got := []wsFrame{read(t, cb), read(t, cb)}
	if got[0].Type != "relay.msg" || got[0].Data["msgSeq"] != float64(1) ||
		got[1].Data["msgSeq"] != float64(2) {
		t.Fatalf("want buffered msgs 1,2 in order, got %v", got)
	}
}

func TestRelay_ResumeWrongTokenNoOracle(t *testing.T) {
	ts, st, _ := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()
	defer func() { _ = cb.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil)
	establish(t, ca, cb, sid)
	send(t, cb, "relay.resume", map[string]any{"sessionId": sid, "resumeToken": "wrong"})
	f := read(t, cb)
	if f.Type != "relay.error" || f.Data["code"] != "not_found" {
		t.Fatalf("want not_found (no oracle), got %v", f)
	}
}

func TestRelay_BurnClosesBoth(t *testing.T) {
	ts, st, rl := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()
	defer func() { _ = cb.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil)
	establish(t, ca, cb, sid)
	send(t, ca, "relay.burn", map[string]any{"sessionId": sid})
	for _, c := range []*websocket.Conn{ca, cb} {
		f := read(t, c)
		if f.Type != "relay.closed" || f.Data["reason"] != "burned" {
			t.Fatalf("want closed{burned}, got %v", f)
		}
	}
	if rl.SessionCount() != 0 {
		t.Fatalf("session must be destroyed, count=%d", rl.SessionCount())
	}
}

func TestRelay_StrictDiesOnDisconnect(t *testing.T) {
	ts, st, _ := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()

	sid := invite(t, ca, cb, ub.ID, map[string]any{"strict": true})
	establish(t, ca, cb, sid)
	_ = cb.Close() // strict → instant peer-gone, no grace
	f := read(t, ca)
	if f.Type != "relay.closed" || f.Data["reason"] != "peer-gone" {
		t.Fatalf("want closed{peer-gone}, got %v", f)
	}
}

func TestRelay_TTLExpiry(t *testing.T) {
	ts, st, _ := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()
	defer func() { _ = cb.Close() }()

	sid := invite(t, ca, cb, ub.ID, map[string]any{"ttlSeconds": 2})
	establish(t, ca, cb, sid)
	for _, c := range []*websocket.Conn{ca, cb} {
		f := read(t, c)
		if f.Type != "relay.closed" || f.Data["reason"] != "timer" {
			t.Fatalf("want closed{timer}, got %v", f)
		}
	}
}

func TestRelay_InviteExpiry(t *testing.T) {
	ts, st, rl := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()
	defer func() { _ = cb.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil) // b never accepts; InviteTTL=400ms
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		f := read(t, ca)
		if f.Type == "relay.closed" && f.Data["reason"] == "expired" {
			if rl.SessionCount() != 0 {
				t.Fatal("expired session must be destroyed")
			}
			return
		}
	}
	t.Fatalf("want closed{expired} for %s", sid)
}

func TestRelay_Decline(t *testing.T) {
	ts, st, rl := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()
	defer func() { _ = cb.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil)
	send(t, cb, "relay.decline", map[string]any{"sessionId": sid})
	f := read(t, ca)
	if f.Type != "relay.declined" {
		t.Fatalf("want relay.declined, got %v", f)
	}
	if rl.SessionCount() != 0 {
		t.Fatal("declined session must be destroyed")
	}
}

func TestRelay_GraceWindowSurvivesBlip(t *testing.T) {
	ts, st, rl := newTestRelay(t)
	ua, ub := mkUser(t, st, "a@x"), mkUser(t, st, "b@x")
	befriend(t, st, ua, ub)
	ca, cb := connect(t, ts, ua.ID, "sa"), connect(t, ts, ub.ID, "sb")
	defer func() { _ = ca.Close() }()

	sid := invite(t, ca, cb, ub.ID, nil)
	establish(t, ca, cb, sid)
	_ = cb.Close()                   // blip
	cb = connect(t, ts, ub.ID, "sb") // back inside PeerGrace=300ms
	defer func() { _ = cb.Close() }()
	est := read(t, cb) // re-emitted established
	if est.Type != "relay.established" {
		t.Fatalf("want established re-emit, got %v", est)
	}
	time.Sleep(500 * time.Millisecond) // past grace — session must still live
	if rl.SessionCount() != 1 {
		t.Fatal("session must survive a within-grace reconnect")
	}
	_ = sid
}
