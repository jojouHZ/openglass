// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"crypto/sha256"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/store"
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
var tagRe = regexp.MustCompile(`^[^\s#]{1,32}#[0-9]{1,5}$`)

type otpRequestBody struct {
	Email      string `json:"email"`
	InviteCode string `json:"inviteCode"`
}

func (s *Server) requestOtp(w http.ResponseWriter, r *http.Request) {
	var body otpRequestBody
	if err := decode(r, &body); err != nil || !emailRe.MatchString(body.Email) {
		badRequest(w, "Invalid email", map[string]any{"email": "invalid"})
		return
	}
	email := strings.ToLower(body.Email)

	// unknown email → invite gates account creation (contract: invite is
	// validated here but consumed only at successful verifyOtp)
	if _, err := s.store.UserByEmail(r.Context(), email); errors.Is(err, store.ErrNotFound) {
		if body.InviteCode == "" {
			writeErr(w, http.StatusForbidden, "invite_required",
				"Invite code required to register", nil)
			return
		}
		ok, err := s.store.InviteValid(r.Context(), body.InviteCode)
		if err != nil {
			writeErrorFromErr(w, err)
			return
		}
		if !ok {
			writeErr(w, http.StatusForbidden, "invite_invalid",
				"Invite code is invalid or already used", nil)
			return
		}
	}

	// resend cooldown — contract constant 60 s
	if prev, err := s.store.OtpFor(r.Context(), email); err == nil {
		if wait := time.Until(prev.NextResendAt); wait > 0 {
			w.Header().Set("Retry-After", itoa(int(wait.Seconds())+1))
			writeErr(w, http.StatusTooManyRequests, "otp_cooldown",
				"Wait before requesting a new code",
				map[string]any{"resendAvailableInS": int(wait.Seconds()) + 1})
			return
		}
	}

	code, hash, err := auth.Generate()
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	now := time.Now()
	rec := &store.OtpRecord{
		Email:        email,
		CodeHash:     hash,
		AttemptsLeft: s.cfg.OtpMaxAttempts,
		ExpiresAt:    now.Add(s.cfg.OtpTTL),
		NextResendAt: now.Add(s.cfg.OtpResendCooldown),
	}
	if body.InviteCode != "" {
		rec.InviteCode = &body.InviteCode
	}
	if err := s.store.SaveOtp(r.Context(), rec); err != nil {
		writeErrorFromErr(w, err)
		return
	}
	if err := s.sender.SendOtp(r.Context(), email, code); err != nil {
		writeErrorFromErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"otpExpiresInS":      int(s.cfg.OtpTTL.Seconds()),
		"resendAvailableInS": int(s.cfg.OtpResendCooldown.Seconds()),
	})
}

type otpVerifyBody struct {
	Email      string `json:"email"`
	Code       string `json:"code"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) verifyOtp(w http.ResponseWriter, r *http.Request) {
	var body otpVerifyBody
	if err := decode(r, &body); err != nil || !emailRe.MatchString(body.Email) ||
		len(body.Code) != 6 || body.DeviceName == "" {
		badRequest(w, "email, 6-digit code and deviceName are required",
			map[string]any{"email": "valid", "code": "6 digits", "deviceName": "required"})
		return
	}
	email := strings.ToLower(body.Email)

	rec, err := s.store.OtpFor(r.Context(), email)
	if errors.Is(err, store.ErrNotFound) || (err == nil && time.Now().After(rec.ExpiresAt)) {
		_ = s.store.DeleteOtp(r.Context(), email)
		writeErr(w, http.StatusForbidden, "otp_expired",
			"Code expired, request a new one", nil)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	if !auth.Verify(body.Code, rec.CodeHash) {
		left, _ := s.store.DecrementOtpAttempts(r.Context(), email)
		if left <= 0 {
			_ = s.store.DeleteOtp(r.Context(), email)
		}
		writeErr(w, http.StatusForbidden, "otp_invalid", "Wrong code",
			map[string]any{"attemptsLeft": left})
		return
	}
	_ = s.store.DeleteOtp(r.Context(), email)

	// consume the pending invite — only now, per contract
	if rec.InviteCode != nil {
		if err := s.store.ConsumeInvite(r.Context(), *rec.InviteCode); err != nil {
			writeErr(w, http.StatusForbidden, "invite_invalid",
				"Invite code is invalid or already used", nil)
			return
		}
	}

	user, err := s.store.UserByEmail(r.Context(), email)
	if errors.Is(err, store.ErrNotFound) {
		user, err = s.store.CreateUser(r.Context(), email)
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}

	pair, err := s.issueSession(r, user.ID, body.DeviceName)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	resp := map[string]any{
		"needsProfile":          user.Tag == "",
		"accessToken":           pair.AccessToken,
		"accessTokenExpiresInS": pair.AccessTokenExpiresInS,
		"refreshToken":          pair.RefreshToken,
	}
	if user.Tag != "" {
		resp["user"] = userJSON(user)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) issueSession(r *http.Request, userID, deviceName string) (*auth.TokenPair, error) {
	sess, err := s.store.CreateSession(r.Context(), userID, deviceName, []byte{0})
	if err != nil {
		return nil, err
	}
	pair, err := s.tokens.NewPair(userID, sess.ID)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(pair.RefreshToken))
	if err := s.store.RotateSessionRefresh(r.Context(), sess.ID, hash[:]); err != nil {
		return nil, err
	}
	return pair, nil
}

type completeProfileBody struct {
	DisplayName  string `json:"displayName"`
	RequestedTag string `json:"requestedTag"`
}

func (s *Server) completeProfile(w http.ResponseWriter, r *http.Request) {
	var body completeProfileBody
	if err := decode(r, &body); err != nil ||
		len(strings.TrimSpace(body.DisplayName)) == 0 || len(body.DisplayName) > 64 {
		badRequest(w, "displayName 1..64 chars", map[string]any{"displayName": "required"})
		return
	}

	me, err := s.store.UserByID(r.Context(), userID(r))
	if err != nil {
		unauthorized(w)
		return
	}
	if me.Tag != "" {
		conflict(w, "Profile already exists", nil)
		return
	}

	// candidate tag: explicit request, else display-name prefix — both
	// must satisfy the contract's `name#NNNN` shape before the bind.
	prefix := slug(body.DisplayName)
	candidate := body.RequestedTag
	if candidate == "" {
		candidate = auth.TagFromName(prefix)
	} else if !tagRe.MatchString(candidate) {
		candidate = auth.TagFromName(slug(candidate))
	}

	taken, err := s.store.TagExists(r.Context(), candidate)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	if taken {
		writeErr(w, http.StatusConflict, "tag_taken",
			"Tag is taken, pick a suggestion",
			map[string]any{"tagSuggestions": auth.SuggestTagVariants(prefix)})
		return
	}

	user, err := s.store.CompleteProfile(r.Context(), me.ID, body.DisplayName, candidate)
	if errors.Is(err, store.ErrConflict) {
		writeErr(w, http.StatusConflict, "tag_taken",
			"Tag is taken, pick a suggestion",
			map[string]any{"tagSuggestions": auth.SuggestTagVariants(prefix)})
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": userJSON(user)})
}

type refreshBody struct {
	RefreshToken string `json:"refreshToken"`
}

func (s *Server) refreshTokens(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	if err := decode(r, &body); err != nil || body.RefreshToken == "" {
		badRequest(w, "refreshToken required", map[string]any{"refreshToken": "required"})
		return
	}
	hash := sha256.Sum256([]byte(body.RefreshToken))
	sess, revoked, err := s.store.SessionByRefreshHash(r.Context(), hash[:])
	if err != nil || revoked {
		// reuse of a rotated/revoked token → whole session already dead
		unauthorized(w)
		return
	}
	if time.Since(sess.CreatedAt) > s.tokens.RefreshExpiry() {
		_ = s.store.RevokeSession(r.Context(), sess.ID)
		unauthorized(w)
		return
	}
	pair, err := s.tokens.NewPair(sess.UserID, sess.ID)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	newHash := sha256.Sum256([]byte(pair.RefreshToken))
	if err := s.store.RotateSessionRefresh(r.Context(), sess.ID, newHash[:]); err != nil {
		writeErrorFromErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"accessToken":           pair.AccessToken,
		"accessTokenExpiresInS": pair.AccessTokenExpiresInS,
		"refreshToken":          pair.RefreshToken,
	})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	_ = s.store.RevokeSession(r.Context(), sessionID(r))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListSessions(r.Context(), userID(r), sessionID(r))
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, sess := range list {
		out = append(out, map[string]any{
			"id":         sess.ID,
			"deviceName": sess.DeviceName,
			"createdAt":  sess.CreatedAt.UTC().Format(time.RFC3339),
			"lastSeenAt": sess.LastSeenAt.UTC().Format(time.RFC3339),
			"current":    sess.ID == sessionID(r),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("sessionId")
	// only the owner's sessions are visible — anything else is not_found
	list, err := s.store.ListSessions(r.Context(), userID(r), "")
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	owned := false
	for _, sess := range list {
		if sess.ID == sid {
			owned = true
			break
		}
	}
	if !owned {
		notFound(w)
		return
	}
	if err := s.store.RevokeSession(r.Context(), sid); err != nil {
		notFound(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func itoa(i int) string { return strconv.Itoa(i) }

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	slugged := strings.Trim(nonAlnum.ReplaceAllString(strings.ToLower(s), ""), "")
	if slugged == "" {
		return "user"
	}
	if len(slugged) > 24 {
		slugged = slugged[:24]
	}
	return slugged
}
