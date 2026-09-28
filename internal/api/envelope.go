// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"encoding/json"
	"net/http"
)

// Response envelope — per docs/api/errors.md.
// Success bodies carry domain fields at top level ({user}, {chats}…);
// errors always wrap as { error: { code, message, details? } }.

type errorBody struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	writeJSON(w, status, map[string]any{
		"error": errorBody{Code: code, Message: message, Details: details},
	})
}

func badRequest(w http.ResponseWriter, msg string, fields map[string]any) {
	writeErr(w, http.StatusBadRequest, "validation_failed", msg,
		map[string]any{"fields": fields})
}

func unauthorized(w http.ResponseWriter) {
	writeErr(w, http.StatusUnauthorized, "unauthorized",
		"Missing or expired access token", nil)
}

func notFound(w http.ResponseWriter) {
	writeErr(w, http.StatusNotFound, "not_found", "Not found", nil)
}

func conflict(w http.ResponseWriter, msg string, details map[string]any) {
	writeErr(w, http.StatusConflict, "conflict", msg, details)
}

func notImplemented(w http.ResponseWriter) {
	writeErr(w, http.StatusNotImplemented, "not_implemented",
		"Endpoint lands with its slice — see docs/api/", nil)
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	return nil
}
