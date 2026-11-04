// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/jojouHZ/openglass/internal/store"
)

// F7 identity-key directory — PUBLIC keys only. The handler layer
// enforces that nothing but a valid base64 SPKI blob reaches the store;
// the server must not learn who verified whom.

const (
	// P-256 SPKI is 91 bytes → 124 b64 chars; accept 32..256 b64 chars
	// (other curves/encodings allowed for forward compat).
	idKeyMinLen = 32
	idKeyMaxLen = 256
	idKeyIDLen  = 64
	idLabelLen  = 64
)

type putIdentityKeyBody struct {
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
	Label     string `json:"label"`
}

func identityKeyJSON(k *store.IdentityKey) map[string]any {
	return map[string]any{
		"keyId":     k.KeyID,
		"publicKey": k.PublicKey,
		"label":     k.Label,
		"createdAt": k.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

func validPublicKey(s string) bool {
	if len(s) < idKeyMinLen || len(s) > idKeyMaxLen {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	return err == nil && len(raw) >= 24
}

func (s *Server) putIdentityKey(w http.ResponseWriter, r *http.Request) {
	var body putIdentityKeyBody
	if err := decode(r, &body); err != nil {
		badRequest(w, "Invalid JSON", nil)
		return
	}
	body.KeyID = strings.TrimSpace(body.KeyID)
	body.Label = strings.TrimSpace(body.Label)
	if body.KeyID == "" || len(body.KeyID) > idKeyIDLen || !validPublicKey(body.PublicKey) {
		badRequest(w, "keyId 1..64, publicKey base64", map[string]any{
			"keyId": "required", "publicKey": "base64",
		})
		return
	}
	if len(body.Label) > idLabelLen {
		badRequest(w, "label max 64 chars", map[string]any{"label": "max 64"})
		return
	}
	k, err := s.store.PutIdentityKey(r.Context(), userID(r), body.KeyID, body.PublicKey, body.Label)
	if errors.Is(err, store.ErrConflict) {
		conflict(w, "keyId already used for a different key", nil)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": identityKeyJSON(k)})
}

func (s *Server) listMyIdentityKeys(w http.ResponseWriter, r *http.Request) {
	s.listIdentityKeysFor(w, r, userID(r))
}

func (s *Server) listIdentityKeys(w http.ResponseWriter, r *http.Request) {
	me := userID(r)
	target := r.PathValue("userId")
	if target != me {
		// the directory is mutual-contacts only — same 404 convention as
		// foreign chats: strangers must not learn whether keys exist
		mutual, err := s.chats.AreMutual(r.Context(), me, target)
		if err != nil || !mutual {
			notFound(w)
			return
		}
	}
	s.listIdentityKeysFor(w, r, target)
}

func (s *Server) listIdentityKeysFor(w http.ResponseWriter, r *http.Request, target string) {
	keys, err := s.store.ListIdentityKeys(r.Context(), target)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]any, 0, len(keys))
	for i := range keys {
		out = append(out, identityKeyJSON(&keys[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": out})
}

func (s *Server) revokeIdentityKey(w http.ResponseWriter, r *http.Request) {
	err := s.store.RevokeIdentityKey(r.Context(), userID(r), r.PathValue("keyId"))
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
