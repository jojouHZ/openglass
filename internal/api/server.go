// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package api — public REST API, contract: docs/api/public-api.openapi.yaml.
//
// Slice boundary: this issue lands auth + users + healthz + ws stub.
// Contacts/chats/messages/groups/push/reports routes exist but answer
// 501 not_implemented until their slices arrive — never silently wrong.
package api

import (
	"context"
	"net/http"

	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/store"
)

// Server — handler set + its dependencies.
type Server struct {
	cfg    *config.Config
	store  store.AuthStore
	chats  store.ChatStore
	tokens *auth.Tokens
	sender auth.OtpSender

	// optional probes for /healthz — nil dep reports "down"
	pgPing    func(context.Context) error
	redisPing func(context.Context) error
}

type Option func(*Server)

func WithPgPing(fn func(context.Context) error) Option { return func(s *Server) { s.pgPing = fn } }
func WithRedisPing(fn func(context.Context) error) Option {
	return func(s *Server) { s.redisPing = fn }
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
func (s *Server) Handler(ws http.HandlerFunc) http.Handler {
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
	v1.HandleFunc("GET /ws", ws)

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

	// contracted-but-unimplemented slices → honest 501, not 404/silence
	stub := s.requireAuth(func(w http.ResponseWriter, _ *http.Request) { notImplemented(w) })
	for _, r := range []string{
		"POST /chats/{chatId}/attachments",
		"POST /groups", "PATCH /groups/{chatId}",
		"POST /groups/{chatId}/members", "DELETE /groups/{chatId}/members/{userId}",
		"PATCH /groups/{chatId}/members/{userId}",
		"POST /groups/{chatId}/ownership",
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
