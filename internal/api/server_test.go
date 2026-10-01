// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Contract tests — the same semantics the mock implements; drift
// between docs/api/ and this server fails here.
package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jojouHZ/openglass/internal/api"
	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/store"
)

func newServer(t *testing.T) (*httptest.Server, *store.Mem, *auth.CaptureSender) {
	t.Helper()
	st := store.NewMem()
	st.SeedInvite("GLS-DEMO")
	sender := auth.NewCaptureSender()
	cfg := &config.Config{
		JWTSecret:         []byte("test-secret"),
		AccessTokenTTL:    15 * time.Minute,
		RefreshTokenTTL:   30 * 24 * time.Hour,
		OtpTTL:            10 * time.Minute,
		OtpResendCooldown: 60 * time.Second,
		OtpMaxAttempts:    5,
		DevMode:           true,
		UploadsDir:        t.TempDir(),
	}
	srv := api.New(cfg, st, sender)
	handler := srv.Handler(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUpgradeRequired)
	})
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	return ts, st, sender
}

func post(t *testing.T, ts *httptest.Server, path, body, bearer string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func get(t *testing.T, ts *httptest.Server, path, bearer string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("GET", ts.URL+path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func errCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

// --- auth flow --------------------------------------------------------

func TestRequestOtp_UnknownEmailRequiresInvite(t *testing.T) {
	ts, _, _ := newServer(t)
	code, body := post(t, ts, "/api/v1/auth/otp/request", `{"email":"new@x.io"}`, "")
	if code != 403 || errCode(body) != "invite_required" {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestRequestOtp_InvalidInvite(t *testing.T) {
	ts, _, _ := newServer(t)
	code, body := post(t, ts, "/api/v1/auth/otp/request",
		`{"email":"new@x.io","inviteCode":"WRONG"}`, "")
	if code != 403 || errCode(body) != "invite_invalid" {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestRequestOtp_WithInvite_ThenCooldown(t *testing.T) {
	ts, _, sender := newServer(t)
	code, body := post(t, ts, "/api/v1/auth/otp/request",
		`{"email":"new@x.io","inviteCode":"GLS-DEMO"}`, "")
	if code != 202 {
		t.Fatalf("got %d %v", code, body)
	}
	if body["otpExpiresInS"].(float64) != 600 || body["resendAvailableInS"].(float64) != 60 {
		t.Fatalf("bad envelope: %v", body)
	}
	if sender.Codes["new@x.io"] == "" {
		t.Fatal("OTP not delivered to sender")
	}
	// immediate resend → otp_cooldown + details.resendAvailableInS
	code, body = post(t, ts, "/api/v1/auth/otp/request",
		`{"email":"new@x.io","inviteCode":"GLS-DEMO"}`, "")
	if code != 429 || errCode(body) != "otp_cooldown" {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestVerifyOtp_FullFlow_ToSessions(t *testing.T) {
	ts, _, sender := newServer(t)
	if c, b := post(t, ts, "/api/v1/auth/otp/request",
		`{"email":"new@x.io","inviteCode":"GLS-DEMO"}`, ""); c != 202 {
		t.Fatalf("request: %d %v", c, b)
	}
	otp := sender.Codes["new@x.io"]

	// wrong code → otp_invalid + attemptsLeft
	code, body := post(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"new@x.io","code":"000000","deviceName":"vitest"}`, "")
	if otp == "000000" {
		t.Skip("generated code collided with the wrong-guess fixture")
	}
	if code != 403 || errCode(body) != "otp_invalid" {
		t.Fatalf("got %d %v", code, body)
	}
	details, _ := body["error"].(map[string]any)["details"].(map[string]any)
	if details["attemptsLeft"].(float64) != 4 {
		t.Fatalf("attemptsLeft: %v", details)
	}

	// right code → tokens + needsProfile (first login)
	code, body = post(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"new@x.io","code":"`+otp+`","deviceName":"vitest"}`, "")
	if code != 200 {
		t.Fatalf("verify: %d %v", code, body)
	}
	if body["needsProfile"] != true {
		t.Fatalf("expected needsProfile=true: %v", body)
	}
	access, _ := body["accessToken"].(string)
	refresh, _ := body["refreshToken"].(string)
	if access == "" || refresh == "" {
		t.Fatal("token pair missing")
	}

	// getMe works with the access token
	code, me := get(t, ts, "/api/v1/users/me", access)
	if code != 200 || me["email"] != "new@x.io" {
		t.Fatalf("getMe: %d %v", code, me)
	}

	// profile completion binds a name#NNNN tag
	code, prof := post(t, ts, "/api/v1/auth/profile",
		`{"displayName":"Neo"}`, access)
	if code != 200 {
		t.Fatalf("completeProfile: %d %v", code, prof)
	}
	tag := prof["user"].(map[string]any)["tag"].(string)
	if !strings.HasPrefix(tag, "neo#") {
		t.Fatalf("tag shape wrong: %s", tag)
	}

	// second completeProfile → conflict
	if c, _ := post(t, ts, "/api/v1/auth/profile", `{"displayName":"Neo2"}`, access); c != 409 {
		t.Fatalf("second profile: %d", c)
	}

	// sessions list shows the current device
	code, sess := get(t, ts, "/api/v1/auth/sessions", access)
	if code != 200 || len(sess["sessions"].([]any)) != 1 {
		t.Fatalf("sessions: %d %v", code, sess)
	}
	if sess["sessions"].([]any)[0].(map[string]any)["current"] != true {
		t.Fatal("current flag missing")
	}

	// refresh rotates; the old token then fails (reuse)
	code, pair := post(t, ts, "/api/v1/auth/refresh",
		`{"refreshToken":"`+refresh+`"}`, "")
	if code != 200 {
		t.Fatalf("refresh: %d %v", code, pair)
	}
	if pair["refreshToken"].(string) == refresh {
		t.Fatal("refresh token did not rotate")
	}
	code, _ = post(t, ts, "/api/v1/auth/refresh", `{"refreshToken":"`+refresh+`"}`, "")
	if code != 401 {
		t.Fatalf("reused refresh: %d", code)
	}
}

func TestVerifyOtp_ExpiredOrMissing(t *testing.T) {
	ts, _, _ := newServer(t)
	code, body := post(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"none@x.io","code":"123456","deviceName":"t"}`, "")
	if code != 403 || errCode(body) != "otp_expired" {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestTagTaken_Suggestions(t *testing.T) {
	ts, st, sender := newServer(t)
	// existing user holding the 'anna' prefix
	u, _ := st.CreateUser(t.Context(), "anna@x.io")
	_, _ = st.CompleteProfile(t.Context(), u.ID, "Anna", "anna#0001")

	post(t, ts, "/api/v1/auth/otp/request", `{"email":"n2@x.io","inviteCode":"GLS-DEMO"}`, "")
	otp := sender.Codes["n2@x.io"]
	_, v := post(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"n2@x.io","code":"`+otp+`","deviceName":"t"}`, "")
	access := v["accessToken"].(string)

	code, body := post(t, ts, "/api/v1/auth/profile",
		`{"displayName":"anna","requestedTag":"anna#0001"}`, access)
	if code != 409 || errCode(body) != "tag_taken" {
		t.Fatalf("got %d %v", code, body)
	}
	sug := body["error"].(map[string]any)["details"].(map[string]any)["tagSuggestions"]
	if len(sug.([]any)) == 0 {
		t.Fatal("no tagSuggestions in details")
	}
}

func TestStubsAre501_NotSilent(t *testing.T) {
	ts, _, sender := newServer(t)
	post(t, ts, "/api/v1/auth/otp/request", `{"email":"s@x.io","inviteCode":"GLS-DEMO"}`, "")
	_, v := post(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"s@x.io","code":"`+sender.Codes["s@x.io"]+`","deviceName":"t"}`, "")
	access := v["accessToken"].(string)

	code, body := post(t, ts, "/api/v1/reports", `{"targetType":"user","targetId":"x","reason":"t"}`, access)
	if code != 501 || errCode(body) != "not_implemented" {
		t.Fatalf("got %d %v", code, body)
	}
	// unauthorized stub still enforces auth
	if c, _ := post(t, ts, "/api/v1/reports", `{}`, ""); c != 401 {
		t.Fatalf("unauth stub: %d", c)
	}
}

func TestLogout_RevokedSessionKillsAccessToken(t *testing.T) {
	ts, _, sender := newServer(t)
	post(t, ts, "/api/v1/auth/otp/request", `{"email":"rv@x.io","inviteCode":"GLS-DEMO"}`, "")
	_, v := post(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"rv@x.io","code":"`+sender.Codes["rv@x.io"]+`","deviceName":"t"}`, "")
	access := v["accessToken"].(string)

	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	resp, _ := http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatalf("logout: %d", resp.StatusCode)
	}
	if c, _ := get(t, ts, "/api/v1/users/me", access); c != 401 {
		t.Fatalf("revoked session access token still works: %d", c)
	}
}

func TestHealthz_DegradedWithoutDeps(t *testing.T) {
	ts, _, _ := newServer(t)
	code, body := get(t, ts, "/api/v1/healthz", "")
	if code != 503 || body["status"] != "degraded" {
		t.Fatalf("got %d %v", code, body)
	}
}
