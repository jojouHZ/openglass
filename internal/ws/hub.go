// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package ws — WebSocket hub stub for the public layer.
//
// Scope (#12): upgrade, first-frame auth per docs/api/ws-events.md
// (auth within 5 s, close 4401 on bad token / 4408 on timeout), and a
// heartbeat. Real delivery (message.*, presence, typing, receipts,
// last_seq replay) lands with the messaging slices.
package ws

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
)

// TokenValidator — the only thing the hub needs from auth.
type TokenValidator func(token string) (userID, sessionID string, err error)

type Hub struct {
	upgrader websocket.Upgrader
	validate TokenValidator
}

func NewHub(validate TokenValidator) *Hub {
	return &Hub{
		validate: validate,
		upgrader: websocket.Upgrader{
			// self-hosted closed community — same-origin PWA; tighten via
			// config when private hosting lands
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Frame — the contract envelope: type/seq/ts/data.
type Frame struct {
	Type string         `json:"type"`
	Seq  int            `json:"seq,omitempty"`
	Ts   string         `json:"ts,omitempty"`
	Data map[string]any `json:"data,omitempty"`
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // upgrade already replied
	}
	defer conn.Close()

	_ = r.URL.Query().Get("last_seq") // replay lands with messaging slices

	// first-frame auth: client must send {type:"auth"} within 5 s
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4408, "auth timeout"))
		return
	}
	var frame Frame
	if err := json.Unmarshal(raw, &frame); err != nil || frame.Type != "auth" {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4401, "expected auth frame"))
		return
	}
	token, _ := frame.Data["accessToken"].(string)
	userID, _, err := h.validate(token)
	seq := 0
	send := func(t string, data map[string]any) error {
		seq++
		return conn.WriteJSON(Frame{Type: t, Seq: seq, Ts: nowTS(), Data: data})
	}
	if err != nil || userID == "" {
		_ = send("auth.fail", map[string]any{"code": "unauthorized"})
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4401, "unauthorized"))
		return
	}
	if err := send("auth.ok", map[string]any{"resumedFromSeq": nil}); err != nil {
		return
	}

	// authenticated read pump: pong on ping, ignore the rest (stub)
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var f Frame
		if json.Unmarshal(raw, &f) == nil && f.Type == "ping" {
			_ = send("pong", map[string]any{})
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	}
}

func nowTS() string { return time.Now().UTC().Format(time.RFC3339) }

// Handler adapts the hub into an http.HandlerFunc (mux wiring in api).
func Handler(validate TokenValidator) http.HandlerFunc {
	h := NewHub(validate)
	return func(w http.ResponseWriter, r *http.Request) {
		// ?last_seq presence is contract-signalled already — accept,
		// replay lands with messaging slices
		if _, err := strconv.Atoi(r.URL.Query().Get("last_seq")); err != nil && r.URL.Query().Get("last_seq") != "" {
			http.Error(w, "bad last_seq", http.StatusBadRequest)
			return
		}
		h.ServeHTTP(w, r)
	}
}
