// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package relay implements the private-layer blind relay:
// WSS /api/v1/relay per docs/api/relay-events.md.
//
// Zero-persistence is structural: the relay reads Directory for peer
// lookup, mutual-contact gating and session liveness — it writes nothing
// to any store. Envelope blobs are opaque bytes; session state lives in
// this process's memory and dies with the session (or the process).
package relay

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/jojouHZ/openglass/internal/store"
)

// TokenValidator — validate an access token, return identity + expiry.
type TokenValidator func(token string) (userID, sessionID string, exp time.Time, err error)

// Directory — read-only surface the relay needs. Satisfied by store.Store;
// the relay must never persist anything (contract invariant).
type Directory interface {
	UserByID(ctx context.Context, id string) (*store.User, error)
	AreMutual(ctx context.Context, a, b string) (bool, error)
	SessionActive(ctx context.Context, sessionID string) (bool, error)
}

// Frame — contract envelope: type/ts/data. No seq: ordering inside a
// private session is the msgSeq on relay.msg; control events are
// idempotent (contract §Framing).
type Frame struct {
	Type string         `json:"type"`
	Ts   string         `json:"ts,omitempty"`
	Data map[string]any `json:"data,omitempty"`
}

const (
	closeUnauthorized = 4401
	closeAuthTimeout  = 4408

	authWindow   = 5 * time.Second
	idleDeadline = 90 * time.Second
	sendBuf      = 256

	inviteTTL     = 60 * time.Second
	peerGrace     = 60 * time.Second
	minSessionTTL = 60 * time.Second
	maxSessionTTL = 24 * time.Hour

	bufMaxMsgs  = 256
	bufMaxBytes = 1 << 20 // 1 MiB per session, whichever cap hits first

	readLimit = 256 << 10 // client frames carry base64 blobs
)

const (
	stPending = iota
	stEstablished
	stClosed
)

type envelope struct {
	seq  int64
	blob string
}

type session struct {
	id         string
	a, b       string // inviter, invitee userIDs
	resumeTok  map[string]string
	state      int
	strict     bool
	burnOnRead bool
	ttlEndsAt  time.Time
	msgSeq     int64
	buf        map[string][]envelope // recipient userID → queued envelopes
	bufBytes   int
	timer      *time.Timer            // invite expiry or session TTL
	grace      map[string]*time.Timer // userID → pending peer-gone close
	// conns that already got the live relay.invite — emitKnownSessions
	// must not re-send it to them (auth.ok → scan races the live emit)
	inviteSent map[*conn]struct{}
}

type conn struct {
	ws          *websocket.Conn
	send        chan Frame
	done        chan struct{}
	closeCode   int // written under r.mu; read by writer
	userID      string
	sessionID   string // device session from the JWT
	expiryTimer *time.Timer
}

// Relay — private-layer blind relay.
type Relay struct {
	upgrader websocket.Upgrader
	validate TokenValidator
	dir      Directory

	// Tunables — tests shrink them.
	PeerGrace time.Duration // disconnect grace before peer-gone close
	InviteTTL time.Duration // unanswered invite lifetime
	MinTTL    time.Duration // session ttlSeconds clamp lower bound
	MaxTTL    time.Duration // session ttlSeconds clamp upper bound

	mu       sync.Mutex
	sessions map[string]*session
	conns    map[string]map[*conn]struct{} // userID → live conns
	done     chan struct{}
}

func New(validate TokenValidator, dir Directory) *Relay {
	return &Relay{
		validate:  validate,
		dir:       dir,
		PeerGrace: peerGrace,
		InviteTTL: inviteTTL,
		MinTTL:    minSessionTTL,
		MaxTTL:    maxSessionTTL,
		sessions:  map[string]*session{},
		conns:     map[string]map[*conn]struct{}{},
		done:      make(chan struct{}),
		upgrader: websocket.Upgrader{
			// same-origin PWA; tighten via config when private hosting lands
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Close — test/shutdown teardown.
func (r *Relay) Close() { close(r.done) }

func nowTS() string { return time.Now().UTC().Format(time.RFC3339) }

// SessionCount — live session count (metrics/tests; never logs pairs).
func (r *Relay) SessionCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.sessions)
}

// RevokeSessionConns — a device session was revoked: its private sessions
// die (relay.closed{revoked} to both) and its conns close 4401.
func (r *Relay) RevokeSessionConns(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var cs []*conn
	for _, set := range r.conns {
		for c := range set {
			if c.sessionID == sessionID {
				cs = append(cs, c)
			}
		}
	}
	for _, c := range cs {
		for _, s := range r.sessions {
			if s.state == stEstablished && (s.a == c.userID || s.b == c.userID) {
				r.closeSessionLocked(s, "revoked")
			}
		}
		r.closeConnWithLocked(c, closeUnauthorized)
	}
}

// ---- connection lifecycle ----

func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	wsc, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	c := &conn{ws: wsc, send: make(chan Frame, sendBuf), done: make(chan struct{})}
	wsc.SetReadLimit(readLimit)

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
	userID, sessionID, exp, err := r.validate(token)
	if err != nil || userID == "" || sessionID == "" {
		_ = wsc.WriteJSON(Frame{Type: "auth.fail", Data: map[string]any{"code": "unauthorized"}})
		closeRaw(wsc, closeUnauthorized, "unauthorized")
		return
	}
	if active, err := r.dir.SessionActive(req.Context(), sessionID); err != nil || !active {
		_ = wsc.WriteJSON(Frame{Type: "auth.fail", Data: map[string]any{"code": "unauthorized"}})
		closeRaw(wsc, closeUnauthorized, "session revoked")
		return
	}
	c.userID, c.sessionID = userID, sessionID

	r.attach(c)
	go r.writer(c)
	defer func() {
		r.detach(c)
		_ = wsc.Close()
	}()

	r.send(c, Frame{Type: "auth.ok", Ts: nowTS(), Data: map[string]any{}})
	r.emitKnownSessions(c)
	r.afterExpiry(c, exp)

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
		r.dispatch(req.Context(), c, &f)
		_ = wsc.SetReadDeadline(time.Now().Add(idleDeadline))
	}
}

func (r *Relay) attach(c *conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns[c.userID] == nil {
		r.conns[c.userID] = map[*conn]struct{}{}
	}
	r.conns[c.userID][c] = struct{}{}
	// conn live → this user is back online; cancel pending peer-gone closes
	// and tell the peer the user is reachable again (peer-offline must not
	// be a one-way state leak)
	for _, s := range r.sessions {
		if t := s.grace[c.userID]; t != nil {
			t.Stop()
			delete(s.grace, c.userID)
			if s.state == stEstablished {
				r.emitToUserLocked(other(s, c.userID), "relay.peer-online",
					map[string]any{"sessionId": s.id})
			}
		}
	}
}

func (r *Relay) detach(c *conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	set := r.conns[c.userID]
	delete(set, c)
	if len(set) == 0 {
		delete(r.conns, c.userID)
	}
	r.closeConnLocked(c)
	if r.conns[c.userID] != nil {
		return // other conns still live — user is online
	}
	// last conn gone → peer-offline + grace (or instant death for strict)
	for _, s := range r.sessions {
		delete(s.inviteSent, c) // release the dead conn reference
		if s.state != stEstablished || (s.a != c.userID && s.b != c.userID) {
			continue
		}
		if s.strict {
			r.closeSessionLocked(s, "peer-gone")
			continue
		}
		peer := other(s, c.userID)
		r.emitToUserLocked(peer, "relay.peer-offline",
			map[string]any{"sessionId": s.id,
				"graceEndsAt": time.Now().Add(r.PeerGrace).UTC().Format(time.RFC3339)})
		uid := c.userID
		s.grace[uid] = time.AfterFunc(r.PeerGrace, func() {
			r.mu.Lock()
			if s.state == stEstablished {
				r.closeSessionLocked(s, "peer-gone")
			}
			r.mu.Unlock()
		})
	}
}

// emitKnownSessions re-syncs a fresh conn: pending invites for this user
// and established sessions they belong to (rejoin after reconnect —
// relay.established is idempotent by sessionId).
// Peer lookups run outside r.mu — a PG read under the global lock would
// stall every relay op.
func (r *Relay) emitKnownSessions(c *conn) {
	type pendingEmit struct {
		sid, otherID string
		pending      bool
	}
	r.mu.Lock()
	var todo []pendingEmit
	for _, s := range r.sessions {
		switch {
		case s.state == stPending && s.b == c.userID:
			if _, live := s.inviteSent[c]; live {
				continue // this conn already got the live relay.invite
			}
			todo = append(todo, pendingEmit{sid: s.id, otherID: s.a, pending: true})
		case s.state == stEstablished && (s.a == c.userID || s.b == c.userID):
			todo = append(todo, pendingEmit{sid: s.id, otherID: other(s, c.userID)})
		}
	}
	r.mu.Unlock()

	ctx := context.Background()
	for _, e := range todo {
		r.mu.Lock()
		s := r.sessions[e.sid]
		// re-validate the state captured in pass 1 — pending may have
		// flipped to established or the session may have died in between
		if s == nil || (e.pending && s.state != stPending) ||
			(!e.pending && s.state != stEstablished) {
			r.mu.Unlock()
			continue
		}
		data := map[string]any{"sessionId": s.id}
		typ := "relay.established"
		if e.pending {
			typ = "relay.invite"
			data["ttlSeconds"] = int(time.Until(s.ttlEndsAt).Seconds())
			data["burnOnRead"] = s.burnOnRead
			data["strict"] = s.strict
			s.inviteSent[c] = struct{}{}
		} else {
			data["resumeToken"] = s.resumeTok[c.userID]
			data["ttlEndsAt"] = s.ttlEndsAt.UTC().Format(time.RFC3339)
		}
		r.mu.Unlock()
		if e.pending {
			data["from"] = peerJSON(ctx, r.dir, e.otherID)
		} else {
			data["peer"] = peerJSON(ctx, r.dir, e.otherID)
		}
		r.send(c, Frame{Type: typ, Ts: nowTS(), Data: data})
	}
}

func (r *Relay) writer(c *conn) {
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

func (r *Relay) send(c *conn, f Frame) {
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

func (r *Relay) closeConnLocked(c *conn) { r.closeConnWithLocked(c, 0) }

func (r *Relay) closeConnWithLocked(c *conn, code int) {
	select {
	case <-c.done:
	default:
		c.closeCode = code
		close(c.done)
	}
}

// afterExpiry drops the conn with 4401 the moment its token dies.
func (r *Relay) afterExpiry(c *conn, exp time.Time) {
	if exp.IsZero() {
		return
	}
	c.expiryTimer = time.AfterFunc(time.Until(exp), func() {
		r.mu.Lock()
		r.closeConnWithLocked(c, closeUnauthorized)
		r.mu.Unlock()
	})
}

// ---- client → server dispatch ----

func (r *Relay) dispatch(ctx context.Context, c *conn, f *Frame) {
	switch f.Type {
	case "ping":
		r.send(c, Frame{Type: "pong", Ts: nowTS(), Data: map[string]any{}})
	case "relay.invite":
		r.onInvite(ctx, c, f.Data)
	case "relay.accept":
		r.onAccept(ctx, c, str(f.Data["sessionId"]))
	case "relay.decline":
		r.onDecline(c, str(f.Data["sessionId"]))
	case "relay.send":
		r.onSend(c, str(f.Data["sessionId"]), str(f.Data["blob"]))
	case "relay.resume":
		r.onResume(c, str(f.Data["sessionId"]), str(f.Data["resumeToken"]))
	case "relay.burn":
		r.onBurn(c, str(f.Data["sessionId"]))
	}
}

func (r *Relay) onInvite(ctx context.Context, c *conn, d map[string]any) {
	peerID := str(d["toUserId"])
	ttl := int64(num(d["ttlSeconds"]))
	if ttl <= 0 {
		ttl = 600 // default per contract
	}
	if ttl < int64(r.MinTTL/time.Second) || ttl > int64(r.MaxTTL/time.Second) || peerID == "" {
		r.errTo(c, "validation_failed")
		return
	}
	mutual, err := r.dir.AreMutual(ctx, c.userID, peerID)
	if err != nil || !mutual || peerID == c.userID {
		r.errTo(c, "not_participant")
		return
	}
	ttlEnd := time.Now().Add(time.Duration(ttl) * time.Second)
	s := &session{
		id:         newUUID(),
		a:          c.userID,
		b:          peerID,
		resumeTok:  map[string]string{c.userID: newToken(), peerID: newToken()},
		state:      stPending,
		strict:     d["strict"] == true,
		burnOnRead: d["burnOnRead"] == true,
		ttlEndsAt:  ttlEnd,
		buf:        map[string][]envelope{},
		grace:      map[string]*time.Timer{},
		inviteSent: map[*conn]struct{}{},
	}
	fromPeer := peerJSON(ctx, r.dir, c.userID) // DB read before the lock
	r.mu.Lock()
	r.sessions[s.id] = s
	s.timer = time.AfterFunc(r.InviteTTL, func() {
		r.mu.Lock()
		if s.state == stPending {
			r.closeSessionLocked(s, "expired") // inviter only — b never joined
		}
		r.mu.Unlock()
	})
	r.emitToUserLocked(peerID, "relay.invite", map[string]any{
		"sessionId":  s.id,
		"from":       fromPeer,
		"ttlSeconds": int(ttl),
		"burnOnRead": s.burnOnRead,
		"strict":     s.strict,
	})
	for c := range r.conns[peerID] {
		s.inviteSent[c] = struct{}{}
	}
	r.mu.Unlock()
}

func (r *Relay) onAccept(ctx context.Context, c *conn, sid string) {
	// phase 1: resolve participant ids under the lock
	r.mu.Lock()
	s := r.sessions[sid]
	if s == nil || s.state != stPending || s.b != c.userID {
		r.mu.Unlock()
		r.errTo(c, "not_found")
		return
	}
	a, b := s.a, s.b
	r.mu.Unlock()

	// peer lookups hit the store — outside the lock
	peers := map[string]map[string]any{
		a: peerJSON(ctx, r.dir, b),
		b: peerJSON(ctx, r.dir, a),
	}

	// phase 2: re-validate (session may have died in between), then mutate
	r.mu.Lock()
	defer r.mu.Unlock()
	if s.state != stPending {
		r.errTo(c, "not_found")
		return
	}
	s.state = stEstablished
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(time.Until(s.ttlEndsAt), func() {
		r.mu.Lock()
		if s.state == stEstablished {
			r.closeSessionLocked(s, "timer")
		}
		r.mu.Unlock()
	})
	for _, uid := range []string{s.a, s.b} {
		r.emitToUserLocked(uid, "relay.established", map[string]any{
			"sessionId":   s.id,
			"peer":        peers[uid],
			"resumeToken": s.resumeTok[uid],
			"ttlEndsAt":   s.ttlEndsAt.UTC().Format(time.RFC3339),
		})
	}
}

func (r *Relay) onDecline(c *conn, sid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.sessions[sid]
	if s == nil || s.state != stPending || s.b != c.userID {
		r.errTo(c, "not_found")
		return
	}
	// declined: inviter hears relay.declined, then the session dies
	r.emitToUserLocked(s.a, "relay.declined", map[string]any{"sessionId": s.id})
	r.destroySessionLocked(s)
}

func (r *Relay) onSend(c *conn, sid, blob string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.sessions[sid]
	if s == nil || s.state != stEstablished || (s.a != c.userID && s.b != c.userID) {
		r.errTo(c, "not_found")
		return
	}
	if blob == "" {
		r.errTo(c, "validation_failed")
		return
	}
	s.msgSeq++
	env := envelope{seq: s.msgSeq, blob: blob}
	peer := other(s, c.userID)
	msg := map[string]any{"sessionId": s.id, "msgSeq": env.seq, "blob": env.blob}
	if r.conns[peer] != nil {
		r.emitToUserLocked(peer, "relay.msg", msg)
		return
	}
	// peer offline → buffer for resume (bounded)
	if len(s.buf[peer]) >= bufMaxMsgs || s.bufBytes+len(blob) > bufMaxBytes {
		r.errTo(c, "quota")
		return
	}
	s.buf[peer] = append(s.buf[peer], env)
	s.bufBytes += len(blob)
}

func (r *Relay) onResume(c *conn, sid, token string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.sessions[sid]
	if s == nil || s.state != stEstablished || (s.a != c.userID && s.b != c.userID) ||
		token == "" || s.resumeTok[c.userID] != token {
		// uniform miss — no oracle on token validity
		r.errTo(c, "not_found")
		return
	}
	if t := s.grace[c.userID]; t != nil {
		t.Stop()
		delete(s.grace, c.userID)
	}
	buf := s.buf[c.userID]
	s.buf[c.userID] = nil
	for _, e := range buf {
		s.bufBytes -= len(e.blob)
		r.send(c, Frame{Type: "relay.msg", Ts: nowTS(), Data: map[string]any{
			"sessionId": s.id, "msgSeq": e.seq, "blob": e.blob}})
	}
}

func (r *Relay) onBurn(c *conn, sid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := r.sessions[sid]
	if s == nil || s.state != stEstablished || (s.a != c.userID && s.b != c.userID) {
		r.errTo(c, "not_found")
		return
	}
	r.closeSessionLocked(s, "burned")
}

func (r *Relay) errTo(c *conn, code string) {
	r.send(c, Frame{Type: "relay.error", Ts: nowTS(), Data: map[string]any{"code": code}})
}

// ---- session lifecycle ----

// closeSessionLocked emits relay.closed to both participants then destroys.
func (r *Relay) closeSessionLocked(s *session, reason string) {
	if s.state == stClosed {
		return
	}
	data := map[string]any{"sessionId": s.id, "reason": reason}
	for _, uid := range []string{s.a, s.b} {
		r.emitToUserLocked(uid, "relay.closed", data)
	}
	r.destroySessionLocked(s)
}

// destroySessionLocked — buffers, timers and the registry entry die.
// Zero-persistence: nothing is archived or flushed anywhere else.
func (r *Relay) destroySessionLocked(s *session) {
	s.state = stClosed
	if s.timer != nil {
		s.timer.Stop()
	}
	for _, t := range s.grace {
		t.Stop()
	}
	s.buf = nil
	s.bufBytes = 0
	delete(r.sessions, s.id)
}

func (r *Relay) emitToUserLocked(userID, typ string, data map[string]any) {
	f := Frame{Type: typ, Ts: nowTS(), Data: data}
	for c := range r.conns[userID] {
		select {
		case c.send <- f:
		default:
			r.closeConnLocked(c) // slow consumer — dropped, not persisted
		}
	}
}

func other(s *session, uid string) string {
	if s.a == uid {
		return s.b
	}
	return s.a
}

// peerJSON mirrors the contract User shape (api.userJSON) without pulling
// the api package in — relay stays a leaf.
func peerJSON(ctx context.Context, dir Directory, userID string) map[string]any {
	u, err := dir.UserByID(ctx, userID)
	if err != nil {
		return map[string]any{"id": userID}
	}
	out := map[string]any{"id": u.ID, "avatarUrl": u.AvatarURL}
	if u.DisplayName != "" {
		out["displayName"] = u.DisplayName
	}
	if u.Tag != "" {
		out["tag"] = u.Tag
	}
	return out
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func newToken() string {
	var b [24]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%x", b[:])
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func num(v any) float64 {
	n, _ := v.(float64)
	return n
}
