// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jojouHZ/openglass/internal/api"
	"github.com/jojouHZ/openglass/internal/auth"
	"github.com/jojouHZ/openglass/internal/config"
	"github.com/jojouHZ/openglass/internal/store"
)

func demoServer(t *testing.T) (*httptest.Server, *store.Mem, *auth.CaptureSender) {
	t.Helper()
	st := store.NewMem()
	sender := auth.NewCaptureSender()
	cfg := &config.Config{
		JWTSecret: []byte("test-secret"), AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour,
		OtpTTL: 10 * time.Minute, OtpResendCooldown: time.Minute, OtpMaxAttempts: 5, DevMode: true,
		UploadsDir: t.TempDir(), DemoOTP: "424242", DemoEmailSuffix: "@demo.example.org",
	}
	srv := api.New(cfg, st, sender, api.WithAuthRateLimits(generousLimits()))
	ts := httptest.NewServer(srv.Handler(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUpgradeRequired) }))
	t.Cleanup(ts.Close)
	return ts, st, sender
}

func demoLogin(t *testing.T, ts *httptest.Server, email, invite, code string) (int, map[string]any) {
	t.Helper()
	if c, b := post(t, ts, "/api/v1/auth/otp/request", fmt.Sprintf(`{"email":%q,"inviteCode":%q}`, email, invite), ""); c != 202 {
		t.Fatalf("request: %d %v", c, b)
	}
	return post(t, ts, "/api/v1/auth/otp/verify", fmt.Sprintf(`{"email":%q,"code":%q,"deviceName":"phone"}`, email, code), "")
}

// A multi-use invite plus the demo code lets guests join without any inbox.
func TestDemoAccess_GuestsJoinWithoutAnInbox(t *testing.T) {
	ts, st, _ := demoServer(t)
	if err := st.CreateInvite(t.Context(), "GLS-MASTER", 3, nil); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 3; i++ {
		c, b := demoLogin(t, ts, fmt.Sprintf("guest%d@demo.example.org", i), "GLS-MASTER", "424242")
		if c != 200 || b["accessToken"] == nil {
			t.Fatalf("guest %d: %d %v", i, c, b)
		}
	}
	// the master invite is exhausted after its uses — demo access does not bypass invites
	if c, _ := post(t, ts, "/api/v1/auth/otp/request", `{"email":"guest4@demo.example.org","inviteCode":"GLS-MASTER"}`, ""); c < 400 {
		t.Fatalf("an exhausted invite must still be refused, got %d", c)
	}
}

// The demo code is worthless for any real address: no takeover of real accounts.
func TestDemoAccess_NeverWorksForRealAddresses(t *testing.T) {
	ts, st, _ := demoServer(t)
	_ = st.CreateInvite(t.Context(), "GLS-X", 5, nil)
	c, b := demoLogin(t, ts, "owner@gmail.com", "GLS-X", "424242")
	if c != 403 || errCode(b) != "otp_invalid" {
		t.Fatalf("demo code on a real address: %d %v", c, b)
	}
}

func TestDemoAccess_WrongCodeAndAttemptLimitStillApply(t *testing.T) {
	ts, st, _ := demoServer(t)
	_ = st.CreateInvite(t.Context(), "GLS-Y", 5, nil)
	email := "guest@demo.example.org"
	if c, _ := post(t, ts, "/api/v1/auth/otp/request", fmt.Sprintf(`{"email":%q,"inviteCode":"GLS-Y"}`, email), ""); c != 202 {
		t.Fatal("request")
	}
	for i := 0; i < 5; i++ {
		c, _ := post(t, ts, "/api/v1/auth/otp/verify", fmt.Sprintf(`{"email":%q,"code":"000000","deviceName":"p"}`, email), "")
		if c != 403 {
			t.Fatalf("wrong demo-address code %d: %d", i, c)
		}
	}
	// attempts exhausted: even the right demo code needs a fresh request
	if c, _ := post(t, ts, "/api/v1/auth/otp/verify", fmt.Sprintf(`{"email":%q,"code":"424242","deviceName":"p"}`, email), ""); c != 403 {
		t.Fatalf("exhausted attempts must lock the demo code out too: %d", c)
	}
}

// Off by default: with no demo config the fixed code is just a wrong code.
func TestDemoAccess_OffByDefault(t *testing.T) {
	ts, _, _ := newServer(t)
	post(t, ts, "/api/v1/auth/otp/request", `{"email":"guest@demo.example.org","inviteCode":"GLS-DEMO"}`, "")
	if c, _ := post(t, ts, "/api/v1/auth/otp/verify", `{"email":"guest@demo.example.org","code":"424242","deviceName":"p"}`, ""); c != 403 {
		t.Fatalf("demo code must be inert when not configured: %d", c)
	}
}
