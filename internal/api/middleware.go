// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const (
	ctxUserID ctxKey = iota
	ctxSessionID
)

func userID(r *http.Request) string {
	v, _ := r.Context().Value(ctxUserID).(string)
	return v
}

func sessionID(r *http.Request) string {
	v, _ := r.Context().Value(ctxSessionID).(string)
	return v
}

// requireAuth — bearer token → userID/sessionID in context; else 401.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || token == "" {
			unauthorized(w)
			return
		}
		uid, sid, err := s.tokens.ParseAccess(token)
		if err != nil {
			unauthorized(w)
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserID, uid)
		ctx = context.WithValue(ctx, ctxSessionID, sid)
		next(w, r.WithContext(ctx))
	}
}
