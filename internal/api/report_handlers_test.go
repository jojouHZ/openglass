// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jojouHZ/openglass/internal/api"
)

const unknownUUID = "00000000-0000-4000-8000-000000000000"

func TestReports_AcceptedStoredAndInvisibleToTarget(t *testing.T) {
	ts, st, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	c, b := post(t, ts, "/api/v1/reports",
		fmt.Sprintf(`{"userId":%q,"reason":"  spam in group chats  "}`, bID), aTok)
	if c != 202 {
		t.Fatalf("report: %d %v", c, b)
	}
	rep := b["report"].(map[string]any)
	if rep["status"] != "received" || rep["id"] == "" {
		t.Fatalf("body: %v", b)
	}
	list, _ := st.ListReports(t.Context(), "open")
	if len(list) != 1 || list[0].Reason != "spam in group chats" ||
		list[0].ReporterID == nil || *list[0].ReporterID != aID ||
		list[0].TargetUserID == nil || *list[0].TargetUserID != bID ||
		list[0].ReporterTag != "alice#0001" || list[0].TargetTag != "bob#0002" {
		t.Fatalf("stored report: %+v", list)
	}
	// no automatic effect: the target sees nothing and keeps working
	if c, _ := get(t, ts, "/api/v1/users/me", bTok); c != 200 {
		t.Fatalf("target is unaffected, got %d", c)
	}
}

func TestReports_Validation(t *testing.T) {
	ts, st, sender := newLimitedServerFull(t, generousLimits())
	aTok, aID := mkUser(t, ts, st, sender, "va@x.io", "va#0001")
	_, bID := mkUser(t, ts, st, sender, "vb@x.io", "vb#0002")
	cases := []struct {
		name, body string
		tok        string
		want       int
	}{
		{"empty reason", fmt.Sprintf(`{"userId":%q,"reason":""}`, bID), aTok, 400},
		{"whitespace reason", fmt.Sprintf(`{"userId":%q,"reason":"   \n "}`, bID), aTok, 400},
		{"too long", fmt.Sprintf(`{"userId":%q,"reason":%q}`, bID, strings.Repeat("x", 1025)), aTok, 400},
		{"self", fmt.Sprintf(`{"userId":%q,"reason":"me"}`, aID), aTok, 400},
		{"missing userId", `{"reason":"x"}`, aTok, 400},
		{"unknown user", fmt.Sprintf(`{"userId":%q,"reason":"x"}`, unknownUUID), aTok, 404},
		{"malformed id", `{"userId":"not-a-uuid","reason":"x"}`, aTok, 404},
		{"unauthenticated", fmt.Sprintf(`{"userId":%q,"reason":"x"}`, bID), "", 401},
	}
	for _, c := range cases {
		if code, body := post(t, ts, "/api/v1/reports", c.body, c.tok); code != c.want {
			t.Errorf("%s: got %d want %d (%v)", c.name, code, c.want, body)
		}
	}
	// the boundary itself is fine
	if c, _ := post(t, ts, "/api/v1/reports",
		fmt.Sprintf(`{"userId":%q,"reason":%q}`, bID, strings.Repeat("é", 1024)), aTok); c != 202 {
		t.Fatalf("1024 characters must pass: %d", c)
	}
}

func TestReports_RateLimitIsPerUser(t *testing.T) {
	limits := generousLimits()
	limits.Report = api.RateLimitSpec{PerMinute: 1, Burst: 2}
	ts, st, sender := newLimitedServerFull(t, limits)
	aTok, _ := mkUser(t, ts, st, sender, "ra@x.io", "ra#0001")
	_, bID := mkUser(t, ts, st, sender, "rb@x.io", "rb#0002")
	cTok, _ := mkUser(t, ts, st, sender, "rc@x.io", "rc#0003")

	body := fmt.Sprintf(`{"userId":%q,"reason":"again"}`, bID)
	for i := 0; i < 2; i++ {
		if c, _ := post(t, ts, "/api/v1/reports", body, aTok); c != 202 {
			t.Fatalf("report %d: %d", i, c)
		}
	}
	if c, b := post(t, ts, "/api/v1/reports", body, aTok); c != 429 || errCode(b) != "rate_limited" {
		t.Fatalf("third report must be limited: %d %v", c, b)
	}
	// another user's bucket is untouched
	if c, _ := post(t, ts, "/api/v1/reports", body, cTok); c != 202 {
		t.Fatalf("other user must not be limited: %d", c)
	}
}

// Every JSON endpoint caps the request body: an oversized payload is refused
// without being buffered (authenticated and — more importantly — public).
func TestJSONBodyIsCapped(t *testing.T) {
	ts, _, _, aTok, _, _, bID := setupTwoUsers(t)
	big := strings.Repeat("x", 3<<20)
	c, b := post(t, ts, "/api/v1/reports", fmt.Sprintf(`{"userId":%q,"reason":%q}`, bID, big), aTok)
	// refused while DECODING (never reaches validation, which would blame "reason")
	d, _ := b["error"].(map[string]any)["details"].(map[string]any)
	if c != 400 || d["reason"] != nil {
		t.Fatalf("authenticated 3 MiB body must fail at decode: %d %v", c, b)
	}
	if c, _ := post(t, ts, "/api/v1/auth/otp/request", fmt.Sprintf(`{"email":%q}`, big+"@x.io"), ""); c != 400 {
		t.Fatalf("public 3 MiB body: %d, want 400", c)
	}
	// a maximum-size message still fits comfortably
	if c, b := post(t, ts, "/api/v1/auth/otp/request", `{"email":"ok@x.io","inviteCode":"GLS-DEMO"}`, ""); c >= 400 {
		t.Fatalf("normal request broke: %d %v", c, b)
	}
}
