// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// HTTP-level rate-limit coverage — 429 + Retry-After per errors.md.
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

// newLimitedServer — newServer with shrunken auth buckets so limits trip
// deterministically without clock tricks.
func newLimitedServer(t *testing.T, limits api.AuthRateLimits) *httptest.Server {
	ts, _, _ := newLimitedServerFull(t, limits)
	return ts
}

// newLimitedServerFull — same, exposing the store/sender for mkUser.
func newLimitedServerFull(t *testing.T, limits api.AuthRateLimits) (*httptest.Server, *store.Mem, *auth.CaptureSender) {
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
	srv := api.New(cfg, st, sender, api.WithAuthRateLimits(limits))
	ts := httptest.NewServer(srv.Handler(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUpgradeRequired)
	}))
	t.Cleanup(ts.Close)
	return ts, st, sender
}

// generous — a spec that never trips inside a test.
func generousLimits() api.AuthRateLimits {
	g := api.RateLimitSpec{PerMinute: 60000, Burst: 1000}
	return api.AuthRateLimits{
		OtpRequestIP:    g,
		OtpRequestEmail: g,
		OtpVerifyIP:     g,
		RefreshIP:       g,
		Report:          g,
	}
}

func postIP(t *testing.T, ts *httptest.Server, path, body, ip string) (int, map[string]any, http.Header) {
	t.Helper()
	req, _ := http.NewRequest("POST", ts.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if ip != "" {
		req.Header.Set("X-Forwarded-For", ip)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out, resp.Header
}

func TestOtpRequestIPRateLimited(t *testing.T) {
	limits := generousLimits()
	limits.OtpRequestIP = api.RateLimitSpec{PerMinute: 1, Burst: 2}
	ts := newLimitedServer(t, limits)

	// two requests drain the burst; handler responses (403 invite gate)
	// still consume tokens — the limit must not depend on success
	for i := 0; i < 2; i++ {
		code, _, _ := postIP(t, ts, "/api/v1/auth/otp/request",
			`{"email":"victim`+string(rune('a'+i))+`@x.dev","inviteCode":"GLS-DEMO"}`, "10.0.0.1")
		if code == http.StatusTooManyRequests {
			t.Fatalf("request %d should not be limited yet", i+1)
		}
	}
	code, body, hdr := postIP(t, ts, "/api/v1/auth/otp/request",
		`{"email":"victimc@x.dev","inviteCode":"GLS-DEMO"}`, "10.0.0.1")
	if code != http.StatusTooManyRequests || errCode(body) != "rate_limited" {
		t.Fatalf("expected 429 rate_limited, got %d %v", code, body)
	}
	if hdr.Get("Retry-After") == "" {
		t.Fatal("Retry-After header required by the contract")
	}
}

func TestOtpRequestEmailBucket(t *testing.T) {
	limits := generousLimits()
	limits.OtpRequestEmail = api.RateLimitSpec{PerMinute: 1, Burst: 2}
	ts := newLimitedServer(t, limits)

	// same victim email from DIFFERENT source IPs — the per-email bucket
	// is what stops inbox spam when IPs rotate
	emails := `{"email":"target@x.dev","inviteCode":"GLS-DEMO"}`
	postIP(t, ts, "/api/v1/auth/otp/request", emails, "10.0.0.1")
	postIP(t, ts, "/api/v1/auth/otp/request", emails, "10.0.0.2")
	code, body, _ := postIP(t, ts, "/api/v1/auth/otp/request", emails, "10.0.0.3")
	if code != http.StatusTooManyRequests || errCode(body) != "rate_limited" {
		t.Fatalf("third hit on one email must be limited, got %d %v", code, body)
	}
}

func TestOtpVerifyIPRateLimited(t *testing.T) {
	limits := generousLimits()
	limits.OtpVerifyIP = api.RateLimitSpec{PerMinute: 1, Burst: 1}
	ts := newLimitedServer(t, limits)

	postIP(t, ts, "/api/v1/auth/otp/verify", `{"email":"a@x.dev","code":"000000"}`, "10.0.0.9")
	code, body, _ := postIP(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"a@x.dev","code":"000000"}`, "10.0.0.9")
	if code != http.StatusTooManyRequests || errCode(body) != "rate_limited" {
		t.Fatalf("verify flood must be limited, got %d %v", code, body)
	}
	// a different IP is unaffected
	code, _, _ = postIP(t, ts, "/api/v1/auth/otp/verify",
		`{"email":"a@x.dev","code":"000000"}`, "10.0.0.10")
	if code == http.StatusTooManyRequests {
		t.Fatal("different client IP must have its own bucket")
	}
}

func TestRefreshIPRateLimited(t *testing.T) {
	limits := generousLimits()
	limits.RefreshIP = api.RateLimitSpec{PerMinute: 1, Burst: 1}
	ts := newLimitedServer(t, limits)

	postIP(t, ts, "/api/v1/auth/refresh", `{"refreshToken":"x"}`, "10.0.0.20")
	code, body, _ := postIP(t, ts, "/api/v1/auth/refresh", `{"refreshToken":"x"}`, "10.0.0.20")
	if code != http.StatusTooManyRequests || errCode(body) != "rate_limited" {
		t.Fatalf("refresh flood must be limited, got %d %v", code, body)
	}
}
