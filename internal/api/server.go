// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package api — public REST API, contract: docs/api/public-api.openapi.yaml.
//
// Implemented: auth, users, contacts, chats, messages, attachments,
// groups, ws. Push and reports routes still answer 501 not_implemented
// until their slices arrive — never silently wrong.
package api

import (
	"context"
	"net/http"

	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/relay"
	"github.com/jojouHZ/openglass/internal/store"
	"github.com/jojouHZ/openglass/internal/ws"
)

// Server — handler set + its dependencies.
type Server struct {
	cfg    *config.Config
	store  store.AuthStore
	chats  store.ChatStore
	tokens *auth.Tokens
	sender auth.OtpSender
	hub    *ws.Hub      // nil in tests that don't exercise realtime
	relay  *relay.Relay // nil when the private layer isn't wired

	// optional probes for /healthz — nil dep reports "down"
	pgPing    func(context.Context) error
	redisPing func(context.Context) error
}

type Option func(*Server)

func WithPgPing(fn func(context.Context) error) Option { return func(s *Server) { s.pgPing = fn } }
func WithRedisPing(fn func(context.Context) error) Option {
	return func(s *Server) { s.redisPing = fn }
}
func WithHub(h *ws.Hub) Option         { return func(s *Server) { s.hub = h } }
func WithRelay(rl *relay.Relay) Option { return func(s *Server) { s.relay = rl } }

// nil-safe emit wrappers — REST mutates, the hub notifies.
func (s *Server) emitToUsers(userIDs []string, typ string, data map[string]any) {
	if s.hub != nil {
		s.hub.EmitToUsers(userIDs, typ, data)
	}
}
func (s *Server) emitToChat(ctx context.Context, chatID, typ string, data map[string]any) {
	if s.hub != nil {
		s.hub.EmitToChat(ctx, chatID, typ, data)
	}
}
func (s *Server) revokeSessionConns(sessionID string) {
	if s.hub != nil {
		s.hub.Revoke(sessionID)
	}
	if s.relay != nil {
		s.relay.RevokeSessionConns(sessionID)
	}
}

func New(cfg *config.Config, st store.Store, sender auth.OtpSender, opts ...Option) *Server {
	s := &Server{
		cfg:    cfg,
		store:  st,
		chats:  st,
		tokens: auth.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL),
		sender: sender,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Handler — the whole HTTP surface (mounted at server root; /api/v1 inside).
func (s *Server) Handler(wsHandler http.HandlerFunc) http.Handler {
	mux := http.NewServeMux()
	v1 := http.NewServeMux()

	// healthz — outside /api/v1? The spec lists /healthz under the API
	// root; expose both for compose convenience.
	v1.HandleFunc("GET /healthz", s.healthz)

	// auth — public
	v1.HandleFunc("POST /auth/otp/request", s.requestOtp)
	v1.HandleFunc("POST /auth/otp/verify", s.verifyOtp)
	v1.HandleFunc("POST /auth/refresh", s.refreshTokens)

	// auth — bearer
	v1.HandleFunc("POST /auth/profile", s.requireAuth(s.completeProfile))
	v1.HandleFunc("POST /auth/logout", s.requireAuth(s.logout))
	v1.HandleFunc("GET /auth/sessions", s.requireAuth(s.listSessions))
	v1.HandleFunc("DELETE /auth/sessions/{sessionId}", s.requireAuth(s.revokeSession))

	// users — bearer
	v1.HandleFunc("GET /users/me", s.requireAuth(s.getMe))
	v1.HandleFunc("PATCH /users/me", s.requireAuth(s.updateMe))
	v1.HandleFunc("GET /users/search", s.requireAuth(s.searchUsers))
	v1.HandleFunc("GET /users/{userId}", s.requireAuth(s.getUser))

	// ws — upgrade + first-frame auth inside
	v1.HandleFunc("GET /ws", wsHandler)

	// private-layer relay — separate socket per docs/api/relay-events.md;
	// mounted only when the relay is wired (production main).
	if s.relay != nil {
		v1.HandleFunc("GET /relay", s.relay.ServeHTTP)
	}

	// contacts — bearer
	v1.HandleFunc("GET /contacts", s.requireAuth(s.listContacts))
	v1.HandleFunc("POST /contacts", s.requireAuth(s.addContact))
	v1.HandleFunc("DELETE /contacts/{userId}", s.requireAuth(s.removeContact))

	// chats — bearer
	v1.HandleFunc("GET /chats", s.requireAuth(s.listChats))
	v1.HandleFunc("POST /chats", s.requireAuth(s.openDirectChat))
	v1.HandleFunc("GET /chats/{chatId}", s.requireAuth(s.getChat))
	v1.HandleFunc("POST /chats/{chatId}/pin", s.requireAuth(s.setChatPinned))

	// messages — bearer
	v1.HandleFunc("GET /chats/{chatId}/messages", s.requireAuth(s.listMessages))
	v1.HandleFunc("POST /chats/{chatId}/messages", s.requireAuth(s.sendMessage))
	v1.HandleFunc("PATCH /messages/{messageId}", s.requireAuth(s.editMessage))
	v1.HandleFunc("DELETE /messages/{messageId}", s.requireAuth(s.deleteMessage))
	v1.HandleFunc("POST /messages/{messageId}/pin", s.requireAuth(s.setMessagePinned))
	v1.HandleFunc("POST /chats/{chatId}/read", s.requireAuth(s.markRead))

	// attachments — member-only upload/download (B4)
	v1.HandleFunc("POST /chats/{chatId}/attachments", s.requireAuth(s.uploadAttachment))
	v1.HandleFunc("GET /attachments/{attachmentId}", s.requireAuth(s.downloadAttachment))

	// groups (B3) — party/raid rights model
	v1.HandleFunc("POST /groups", s.requireAuth(s.createGroup))
	v1.HandleFunc("PATCH /groups/{chatId}", s.requireAuth(s.editGroup))
	v1.HandleFunc("POST /groups/{chatId}/members", s.requireAuth(s.addGroupMembers))
	v1.HandleFunc("DELETE /groups/{chatId}/members/{userId}", s.requireAuth(s.removeGroupMember))
	v1.HandleFunc("PATCH /groups/{chatId}/members/{userId}", s.requireAuth(s.setMemberRights))
	v1.HandleFunc("POST /groups/{chatId}/ownership", s.requireAuth(s.transferOwnership))

	// contracted-but-unimplemented slices → honest 501, not 404/silence
	stub := s.requireAuth(func(w http.ResponseWriter, _ *http.Request) { notImplemented(w) })
	for _, r := range []string{
		"GET /push/vapid-key", "GET /push/subscriptions", "POST /push/subscriptions",
		"DELETE /push/subscriptions/{subscriptionId}",
		"POST /reports",
	} {
		v1.HandleFunc(r, stub)
	}

	mux.Handle("/api/v1/", http.StripPrefix("/api/v1", v1))
	mux.HandleFunc("GET /healthz", s.healthz) // infra convenience alias
	return mux
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	status := map[string]any{"status": "ok", "postgres": "up", "redis": "up"}
	code := http.StatusOK
	if s.pgPing == nil || s.pgPing(r.Context()) != nil {
		status["postgres"] = "down"
		code = http.StatusServiceUnavailable
	}
	if s.redisPing == nil || s.redisPing(r.Context()) != nil {
		status["redis"] = "down"
		code = http.StatusServiceUnavailable
	}
	if code != http.StatusOK {
		status["status"] = "degraded"
	}
	writeJSON(w, code, status)
}

// userJSON — contract User shape.
func userJSON(u *store.User) map[string]any {
	return map[string]any{
		"id":          u.ID,
		"displayName": nullStr(u.DisplayName),
		"tag":         nullStr(u.Tag),
		"avatarUrl":   u.AvatarURL,
		"createdAt":   u.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func writeErrorFromErr(w http.ResponseWriter, _ error) {
	writeErr(w, http.StatusInternalServerError, "internal_error", "Internal error", nil)
}
