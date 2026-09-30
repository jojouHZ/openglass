// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package ws — WebSocket hub for the public layer.
// Contract: docs/api/ws-events.md.
//
// Per-session model: every device session owns a monotonic `seq` and a
// bounded in-memory ring of undelivered events. Reconnect with
// `?last_seq=N` replays what the buffer still holds; on gap/eviction the
// client gets `resync.required`. In-memory is deliberate — the same
// replay/resync semantics will back the private-layer relay (no Redis
// in either critical path).
package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// TokenValidator — validate an access token, return identity + expiry.
type TokenValidator func(token string) (userID, sessionID string, exp time.Time, err error)

// Directory — the persistence surface the hub needs: fan-out target
// resolution, presence scope, membership checks, read cursors.
// Satisfied by store.Store (Mem and PG).
type Directory interface {
	ChatMemberIDs(ctx context.Context, chatID string) ([]string, error)
	IsChatMember(ctx context.Context, chatID, userID string) (bool, error)
	MutualContactIDs(ctx context.Context, userID string) ([]string, error)
	MarkRead(ctx context.Context, chatID, userID string, upToSeq int64) error
	// SessionActive — the REST middleware gate, enforced here too:
	// a revoked session must not re-attach on a still-valid JWT.
	SessionActive(ctx context.Context, sessionID string) (bool, error)
}

// Frame — the contract envelope: type/seq/ts/data.
type Frame struct {
	Type string         `json:"type"`
	Seq  int64          `json:"seq,omitempty"`
	Ts   string         `json:"ts,omitempty"`
	Data map[string]any `json:"data,omitempty"`
}

const (
	closeUnauthorized = 4401
	closeAuthTimeout  = 4408

	authWindow   = 5 * time.Second
	idleDeadline = 90 * time.Second
	typingWindow = 5 * time.Second // `typing` event visibility
	offlineGrace = 20 * time.Second
	typingEvery  = 3 * time.Second
	sendBuf      = 256 // per-connection outbound queue
	replayCap    = 256 // per-session ring of undelivered events
	sessionIdle  = 10 * time.Minute
	sweepEvery   = time.Minute
)

// session is a device session: independent seq + replay buffer.
// Multiple conns may attach (multi-tab) — events duplicate per conn.
type session struct {
	id      string
	userID  string
	seq     int64
	buf     []Frame // ring of recent events; buf[0].Seq is oldest kept
	conns   map[*conn]struct{}
	touched time.Time
}

type conn struct {
	ws        *websocket.Conn
	send      chan Frame
	done      chan struct{}
	closeCode int // written under h.mu before done closes; read by writer
}

type Hub struct {
	upgrader websocket.Upgrader
	validate TokenValidator
	dir      Directory

	// Tunables — tests shrink them.
	OfflineGrace   time.Duration
	TypingInterval time.Duration
	SessionIdleTTL time.Duration
	ReplayCap      int

	mu       sync.Mutex
	sessions map[string]*session // sessionID → state
	byUser   map[string]map[string]*session
	online   map[string]int         // userID → live conn count
	grace    map[string]*time.Timer // userID → pending offline emit
	lastType map[string]time.Time   // sessionID:chatID → last typing.start
	done     chan struct{}
	sweep    *time.Ticker
}

func NewHub(validate TokenValidator, dir Directory) *Hub {
	h := &Hub{
		validate:       validate,
		dir:            dir,
		OfflineGrace:   offlineGrace,
		TypingInterval: typingEvery,
		SessionIdleTTL: sessionIdle,
		ReplayCap:      replayCap,
		sessions:       map[string]*session{},
		byUser:         map[string]map[string]*session{},
		online:         map[string]int{},
		grace:          map[string]*time.Timer{},
		lastType:       map[string]time.Time{},
		done:           make(chan struct{}),
		sweep:          time.NewTicker(sweepEvery),
		upgrader: websocket.Upgrader{
			// self-hosted closed community — same-origin PWA; tighten via
			// config when private hosting lands
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	go h.janitor()
	return h
}

// Close stops the janitor — test teardown.
func (h *Hub) Close() {
	close(h.done)
	h.sweep.Stop()
}

func nowTS() string { return time.Now().UTC().Format(time.RFC3339) }

// ---- emit API (called by the api layer after successful mutations) ----

// EmitToUsers assigns a fresh per-session seq, buffers the event for
// replay, and pushes it to every live conn of each user's sessions.
func (h *Hub) EmitToUsers(userIDs []string, typ string, data map[string]any) {
	h.mu.Lock()
	for _, uid := range userIDs {
		for _, s := range h.byUser[uid] {
			h.pushLocked(s, typ, data)
		}
	}
	h.mu.Unlock()
}

// EmitToChat resolves chat members then fans out to all of them.
func (h *Hub) EmitToChat(ctx context.Context, chatID, typ string, data map[string]any) {
	members, err := h.dir.ChatMemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	h.EmitToUsers(members, typ, data)
}

// EmitToChatExcept — chat fan-out minus one user (typing indicators).
func (h *Hub) EmitToChatExcept(ctx context.Context, chatID, except, typ string, data map[string]any) {
	members, err := h.dir.ChatMemberIDs(ctx, chatID)
	if err != nil {
		return
	}
	out := make([]string, 0, len(members))
	for _, u := range members {
		if u != except {
			out = append(out, u)
		}
	}
	h.EmitToUsers(out, typ, data)
}

// Revoke — session was revoked server-side: notify its conns, close
// them, drop the session (its replay buffer dies with it).
func (h *Hub) Revoke(sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.sessions[sessionID]
	if s == nil {
		return
	}
	h.pushLocked(s, "session.revoked", map[string]any{"sessionId": sessionID})
	for c := range s.conns {
		h.closeConnWithLocked(c, closeUnauthorized)
	}
	h.dropSessionLocked(sessionID)
}

// pushLocked — sequenced + buffered emit to one session.
func (h *Hub) pushLocked(s *session, typ string, data map[string]any) {
	s.seq++
	f := Frame{Type: typ, Seq: s.seq, Ts: nowTS(), Data: data}
	s.touched = time.Now()
	s.buf = append(s.buf, f)
	if len(s.buf) > h.ReplayCap {
		s.buf = append(s.buf[:0], s.buf[len(s.buf)-h.ReplayCap:]...)
	}
	for c := range s.conns {
		select {
		case c.send <- f:
		default:
			h.closeConnLocked(c) // slow consumer — reconnect replays
		}
	}
}

// sendSeq — sequenced but unbuffered emit (auth.ok: nothing to replay).
func (h *Hub) sendSeq(s *session, c *conn, typ string, data map[string]any) {
	h.mu.Lock()
	s.seq++
	s.touched = time.Now()
	f := Frame{Type: typ, Seq: s.seq, Ts: nowTS(), Data: data}
	h.mu.Unlock()
	h.send(c, f)
}

func (h *Hub) closeConnLocked(c *conn) {
	h.closeConnWithLocked(c, 0)
}

// closeConnWithLocked — code flows to the writer via done-close ordering,
// so the socket ends with a real WS close frame instead of a bare TCP cut.
func (h *Hub) closeConnWithLocked(c *conn, code int) {
	select {
	case <-c.done:
	default:
		c.closeCode = code
		close(c.done)
	}
}

func (h *Hub) dropSessionLocked(sid string) {
	s := h.sessions[sid]
	if s == nil {
		return
	}
	for c := range s.conns {
		h.closeConnLocked(c)
	}
	delete(h.sessions, sid)
	if ms := h.byUser[s.userID]; ms != nil {
		delete(ms, sid)
		if len(ms) == 0 {
			delete(h.byUser, s.userID)
		}
	}
}

// janitor evicts sessions with no live conns idle past SessionIdleTTL —
// their next reconnect gets resync.required{evicted}.
func (h *Hub) janitor() {
	for {
		select {
		case <-h.done:
			return
		case <-h.sweep.C:
			h.Sweep()
		}
	}
}

// Sweep evicts idle sessions — exported for tests.
func (h *Hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	cutoff := time.Now().Add(-h.SessionIdleTTL)
	for sid, s := range h.sessions {
		if len(s.conns) == 0 && s.touched.Before(cutoff) {
			h.dropSessionLocked(sid)
		}
	}
}

// ---- connection lifecycle ----

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	lastSeq, _ := strconv.ParseInt(r.URL.Query().Get("last_seq"), 10, 64)

	wsc, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // upgrade already replied
	}
	c := &conn{ws: wsc, send: make(chan Frame, sendBuf), done: make(chan struct{})}

	// client frames are small control JSON — cap them before any read
	wsc.SetReadLimit(32 << 10)

	// auth phase — synchronous writes, the pump starts after auth.ok
	_ = wsc.SetReadDeadline(time.Now().Add(authWindow))
	_, raw, err := wsc.ReadMessage()
	if err != nil {
		closeRaw(wsc, closeAuthTimeout, "auth timeout")
		return
	}
	var f Frame
	if json.Unmarshal(raw, &f) != nil || f.Type != "auth" {
		closeRaw(wsc, closeUnauthorized, "expected auth frame")
		return
	}
	token, _ := f.Data["accessToken"].(string)
	userID, sessionID, exp, err := h.validate(token)
	if err != nil || userID == "" || sessionID == "" {
		_ = wsc.WriteJSON(Frame{Type: "auth.fail", Data: map[string]any{"code": "unauthorized"}})
		closeRaw(wsc, closeUnauthorized, "unauthorized")
		return
	}
	if active, err := h.dir.SessionActive(r.Context(), sessionID); err != nil || !active {
		_ = wsc.WriteJSON(Frame{Type: "auth.fail", Data: map[string]any{"code": "unauthorized"}})
		closeRaw(wsc, closeUnauthorized, "session revoked")
		return
	}

	s, replay, resync := h.attach(sessionID, userID, c, lastSeq)
	go h.writer(c)
	defer func() {
		h.detach(s, c)
		h.presence(userID, false)
		_ = wsc.Close()
	}()

	// contract order: missed frames (original seqs) → auth.ok →
	// resync → presence.snapshot — arrival seq stays monotonic
	for _, rf := range replay {
		h.send(c, rf)
	}
	var resumed any
	if lastSeq > 0 && resync == "" {
		resumed = s.seq
	}
	h.sendSeq(s, c, "auth.ok", map[string]any{"resumedFromSeq": resumed})
	if resync != "" {
		h.mu.Lock()
		h.pushLocked(s, "resync.required", map[string]any{"reason": resync})
		h.mu.Unlock()
	}
	h.snapshot(c, s, userID)
	h.afterExpiry(c, exp)
	h.presence(userID, true)

	// read pump — any inbound frame refreshes the 90 s idle deadline
	_ = wsc.SetReadDeadline(time.Now().Add(idleDeadline))
	for {
		_, raw, err := wsc.ReadMessage()
		if err != nil {
			return
		}
		var f Frame
		if json.Unmarshal(raw, &f) != nil {
			continue
		}
		h.dispatchClient(s, &f)
		_ = wsc.SetReadDeadline(time.Now().Add(idleDeadline))
	}
}

// attach registers the conn on its session and decides the replay
// outcome: missed frames, or a resync reason (gap|evicted|"").
func (h *Hub) attach(sessionID, userID string, c *conn, lastSeq int64) (s *session, replay []Frame, resync string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s = h.sessions[sessionID]
	if s == nil {
		s = &session{id: sessionID, userID: userID, conns: map[*conn]struct{}{}, touched: time.Now()}
		h.sessions[sessionID] = s
		if h.byUser[userID] == nil {
			h.byUser[userID] = map[string]*session{}
		}
		h.byUser[userID][sessionID] = s
		if lastSeq > 0 {
			resync = "evicted" // server restart or janitor pruned it
		}
	}
	s.conns[c] = struct{}{}
	if lastSeq > 0 && resync == "" && lastSeq < s.seq {
		oldest := s.seq + 1 // empty buffer → nothing retained
		if len(s.buf) > 0 {
			oldest = s.buf[0].Seq
		}
		if oldest > lastSeq+1 {
			resync = "gap"
		} else {
			for _, f := range s.buf {
				if f.Seq > lastSeq {
					replay = append(replay, f)
				}
			}
		}
	}
	return s, replay, resync
}

func (h *Hub) detach(s *session, c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(s.conns, c)
	h.closeConnLocked(c)
}

// writer drains the outbound queue; on done it flushes what remains
// (e.g. session.revoked) then closes the socket so the read pump exits.
func (h *Hub) writer(c *conn) {
	for {
		select {
		case f := <-c.send:
			if err := c.ws.WriteJSON(f); err != nil {
				_ = c.ws.Close()
				return
			}
		case <-c.done:
			for {
				select {
				case f := <-c.send:
					_ = c.ws.WriteJSON(f)
				default:
					if c.closeCode != 0 {
						_ = c.ws.WriteMessage(websocket.CloseMessage,
							websocket.FormatCloseMessage(c.closeCode, ""))
					}
					_ = c.ws.Close()
					return
				}
			}
		}
	}
}

func (h *Hub) send(c *conn, f Frame) {
	select {
	case c.send <- f:
	case <-c.done:
	}
}

func closeRaw(wsc *websocket.Conn, code int, reason string) {
	_ = wsc.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(code, reason))
	_ = wsc.Close()
}

// afterExpiry drops the conn with 4401 the moment its token dies —
// a socket must not outlive the credential that opened it.
func (h *Hub) afterExpiry(c *conn, exp time.Time) {
	if exp.IsZero() {
		return
	}
	time.AfterFunc(time.Until(exp), func() {
		h.mu.Lock()
		h.closeConnWithLocked(c, closeUnauthorized)
		h.mu.Unlock()
	})
}

// ---- client → server frames ----

func (h *Hub) dispatchClient(s *session, f *Frame) {
	ctx := context.Background()
	switch f.Type {
	case "ping":
		h.mu.Lock()
		h.pushLocked(s, "pong", map[string]any{})
		h.mu.Unlock()
	case "typing.start", "typing.stop":
		chatID, _ := f.Data["chatId"].(string)
		if chatID == "" {
			return
		}
		member, err := h.dir.IsChatMember(ctx, chatID, s.userID)
		if err != nil || !member {
			return // silent — non-member input is dropped, not answered
		}
		if f.Type == "typing.start" {
			key := sessionKey(s) + ":" + chatID
			h.mu.Lock()
			if time.Since(h.lastType[key]) < h.TypingInterval {
				h.mu.Unlock()
				return
			}
			h.lastType[key] = time.Now()
			h.mu.Unlock()
		}
		until := time.Now().Add(typingWindow)
		if f.Type == "typing.stop" {
			until = time.Now()
		}
		h.EmitToChatExcept(ctx, chatID, s.userID, "typing", map[string]any{
			"chatId": chatID, "userId": s.userID,
			"until": until.UTC().Format(time.RFC3339),
		})
	case "receipt.read":
		chatID, _ := f.Data["chatId"].(string)
		upTo, _ := f.Data["upToSeq"].(float64)
		if chatID == "" {
			return
		}
		// same semantics as POST /chats/{id}/read — store enforces membership
		if err := h.dir.MarkRead(ctx, chatID, s.userID, int64(upTo)); err != nil {
			return
		}
		h.EmitToChat(ctx, chatID, "receipt.read", map[string]any{
			"chatId": chatID, "userId": s.userID, "upToSeq": int64(upTo),
		})
	}
}

// sessionKey — throttle is per device session, not per user.
func sessionKey(s *session) string { return s.id }

// ---- presence ----

func (h *Hub) snapshot(c *conn, s *session, userID string) {
	mutuals, _ := h.dir.MutualContactIDs(context.Background(), userID)
	h.mu.Lock()
	var online []string
	for _, m := range mutuals {
		if h.online[m] > 0 {
			online = append(online, m)
		}
	}
	h.pushLocked(s, "presence.snapshot", map[string]any{"onlineUserIds": online})
	h.mu.Unlock()
}

func (h *Hub) presence(userID string, on bool) {
	h.mu.Lock()
	if on {
		if t := h.grace[userID]; t != nil {
			t.Stop()
			delete(h.grace, userID)
		}
		h.online[userID]++
		if h.online[userID] != 1 {
			h.mu.Unlock()
			return // already online via another conn/tab
		}
	} else {
		h.online[userID]--
		if h.online[userID] > 0 {
			h.mu.Unlock()
			return
		}
		delete(h.online, userID)
		// grace window — a flaky reconnect shouldn't flap presence
		h.grace[userID] = time.AfterFunc(h.OfflineGrace, func() {
			h.broadcastPresence(userID, "offline")
			h.mu.Lock()
			delete(h.grace, userID)
			h.mu.Unlock()
		})
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()
	h.broadcastPresence(userID, "online")
}

func (h *Hub) broadcastPresence(userID, status string) {
	mutuals, _ := h.dir.MutualContactIDs(context.Background(), userID)
	h.EmitToUsers(mutuals, "presence", map[string]any{"userId": userID, "status": status})
}
