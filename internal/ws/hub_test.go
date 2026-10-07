// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// White-box hub tests — paths that need unexported state: send-queue
// backpressure and ring-buffer eviction boundaries. Contract behavior
// (auth, replay, fan-out) is covered in internal/api/ws_test.go.
package ws

import (
	"context"
	"testing"
	"time"
)

// fakeDir — Directory stub; fan-out paths are integration-tested
// against the real Mem store, here the surface is unused.
type fakeDir struct{}

func (fakeDir) ChatMemberIDs(context.Context, string) ([]string, error) {
	return nil, nil
}
func (fakeDir) IsChatMember(context.Context, string, string) (bool, error) {
	return true, nil
}
func (fakeDir) MutualContactIDs(context.Context, string) ([]string, error) {
	return nil, nil
}
func (fakeDir) MarkRead(context.Context, string, string, int64) error {
	return nil
}
func (fakeDir) SessionActive(context.Context, string) (bool, error) {
	return true, nil
}

func testHub(t *testing.T) *Hub {
	t.Helper()
	h := NewHub(func(string) (string, string, time.Time, error) {
		return "u1", "s1", time.Now().Add(time.Hour), nil
	}, fakeDir{})
	t.Cleanup(h.Close)
	return h
}

// A conn that never drains its send queue must be dropped — the session
// stays alive so a reconnect can replay what the slow consumer missed.
func TestPushLocked_SlowConsumerDropped(t *testing.T) {
	h := testHub(t)
	s := &session{id: "s1", userID: "u1", conns: map[*conn]struct{}{}, touched: time.Now()}
	c := &conn{send: make(chan Frame), done: make(chan struct{})}
	s.conns[c] = struct{}{}

	h.mu.Lock()
	h.pushLocked(s, "evt", nil)
	h.mu.Unlock()

	select {
	case <-c.done:
	case <-time.After(time.Second):
		t.Fatal("slow consumer conn was not dropped")
	}
	// the event is still buffered — replay survives the drop
	if len(s.buf) != 1 || s.buf[0].Type != "evt" {
		t.Fatalf("dropped conn must not lose the buffered frame: %+v", s.buf)
	}
}

// The ring keeps at most ReplayCap frames; buf[0].Seq is the oldest kept.
func TestPushLocked_RingEvictsOldest(t *testing.T) {
	h := testHub(t)
	h.ReplayCap = 3
	s := &session{conns: map[*conn]struct{}{}, touched: time.Now()}

	h.mu.Lock()
	for i := 0; i < 7; i++ {
		h.pushLocked(s, "evt", nil)
	}
	h.mu.Unlock()

	if len(s.buf) != 3 {
		t.Fatalf("ring must cap at ReplayCap=3, got %d", len(s.buf))
	}
	if s.buf[0].Seq != 5 {
		t.Fatalf("oldest kept seq should be 5, got %d", s.buf[0].Seq)
	}
}

// attach with a last_seq older than the oldest retained frame resolves
// to resync "gap" — the replay window can't be reconstructed.
func TestAttach_GapBeyondRing(t *testing.T) {
	h := testHub(t)
	h.ReplayCap = 2
	s := &session{id: "s1", userID: "u1", conns: map[*conn]struct{}{}, touched: time.Now()}
	h.sessions["s1"] = s
	h.byUser["u1"] = map[string]*session{"s1": s}

	h.mu.Lock()
	for i := 0; i < 4; i++ {
		h.pushLocked(s, "evt", nil)
	}
	h.mu.Unlock()

	_, replay, resync := h.attach("s1", "u1", &conn{send: make(chan Frame, 1), done: make(chan struct{})}, 1)
	if resync != "gap" {
		t.Fatalf("expected gap resync, got %q (replay=%d)", resync, len(replay))
	}
}

// last_seq inside the retained window replays exactly the missed tail.
func TestAttach_ReplaysMissedTail(t *testing.T) {
	h := testHub(t)
	s := &session{id: "s1", userID: "u1", conns: map[*conn]struct{}{}, touched: time.Now()}
	h.sessions["s1"] = s
	h.byUser["u1"] = map[string]*session{"s1": s}

	h.mu.Lock()
	for i := 0; i < 3; i++ {
		h.pushLocked(s, "evt", nil)
	}
	h.mu.Unlock()

	_, replay, resync := h.attach("s1", "u1", &conn{send: make(chan Frame, 8), done: make(chan struct{})}, 1)
	if resync != "" {
		t.Fatalf("unexpected resync %q", resync)
	}
	if len(replay) != 2 || replay[0].Seq != 2 || replay[1].Seq != 3 {
		t.Fatalf("expected replay of seq 2..3, got %+v", replay)
	}
}
