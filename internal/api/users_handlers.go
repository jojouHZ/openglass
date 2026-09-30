// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jojouHZ/openglass/internal/store"
)

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.UserByID(r.Context(), userID(r))
	if err != nil {
		unauthorized(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  userJSON(u),
		"email": u.Email,
	})
}

type updateMeBody struct {
	DisplayName *string `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request) {
	var body updateMeBody
	if err := decode(r, &body); err != nil {
		badRequest(w, "Invalid JSON", nil)
		return
	}
	if body.DisplayName != nil &&
		(len(strings.TrimSpace(*body.DisplayName)) == 0 || len(*body.DisplayName) > 64) {
		badRequest(w, "displayName 1..64 chars", map[string]any{"displayName": "1..64"})
		return
	}
	u, err := s.store.UpdateProfile(r.Context(), userID(r), body.DisplayName, body.AvatarURL)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	s.emitUserUpdated(r.Context(), u)
	writeJSON(w, http.StatusOK, map[string]any{"user": userJSON(u)})
}

func (s *Server) searchUsers(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		badRequest(w, "q must be at least 2 chars", map[string]any{"q": "minLength 2"})
		return
	}
	users, err := s.store.SearchUsers(r.Context(), q, 20)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(users))
	for i := range users {
		out = append(out, userJSON(&users[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

func (s *Server) getUser(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.UserByID(r.Context(), r.PathValue("userId"))
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	rel := "none"
	switch me := userID(r); {
	case u.ID == me:
		rel = "self"
	default:
		out, in, err := s.chats.ContactEdges(r.Context(), me, u.ID)
		if err == nil {
			switch {
			case out && in:
				rel = "contact_mutual"
			case out:
				rel = "contact_outgoing"
			case in:
				rel = "contact_incoming"
			}
		}
	}
	// verifiedAt: always null until the private module ships (contract)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":         userJSON(u),
		"verifiedAt":   nil,
		"relationship": rel,
	})
}
