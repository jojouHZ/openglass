// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/jojouHZ/openglass/internal/store"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// createReport — POST /reports. The report has no automatic effect: the
// reported user is never told, the reporter only learns it was received.
// The operator reads it with `ogadmin reports list`.
func (s *Server) createReport(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID string `json:"userId"`
		Reason string `json:"reason"`
	}
	if err := decode(r, &in); err != nil || in.UserID == "" {
		badRequest(w, "userId and reason are required", map[string]any{"userId": "required"})
		return
	}
	if !uuidRe.MatchString(in.UserID) {
		notFound(w) // a malformed id names nobody
		return
	}
	me := userID(r)
	if wait, ok := s.reportReq.allow("user|" + me); !ok {
		rateLimited(w, wait)
		return
	}
	rep, err := s.chats.CreateReport(r.Context(), me, in.UserID, in.Reason)
	switch {
	case errors.Is(err, store.ErrInvalid):
		if in.UserID == me {
			badRequest(w, "You cannot report yourself", map[string]any{"userId": "self"})
		} else {
			badRequest(w, "reason must be 1..1024 characters", map[string]any{"reason": "length"})
		}
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		writeJSON(w, http.StatusAccepted, map[string]any{
			"report": map[string]any{"id": rep.ID, "status": "received"},
		})
	}
}
