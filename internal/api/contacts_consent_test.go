// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Slice F1 contract tests — contact consent model: request → accept →
// mutual, silent decline, cancel, rate limit, and every WS event.
package api_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/jojouHZ/openglass/internal/api"
)

func ids(list any, key string) []string {
	var out []string
	for _, it := range list.([]any) {
		out = append(out, it.(map[string]any)["user"].(map[string]any)[key].(string))
	}
	return out
}

func TestContactRequests_Lifecycle(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)

	if c, _ := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, aID), aTok); c != 400 {
		t.Fatalf("self request: %d", c)
	}
	c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	if c != 201 || b["relationship"] != "contact_outgoing" || b["request"] == nil {
		t.Fatalf("request: %d %v", c, b)
	}
	// resend while pending: idempotent 200, no new request
	c, b = post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	if c != 200 || b["relationship"] != "contact_outgoing" {
		t.Fatalf("resend: %d %v", c, b)
	}
	_, l := get(t, ts, "/api/v1/contacts/requests", bTok)
	if got := ids(l["incoming"], "id"); len(got) != 1 || got[0] != aID {
		t.Fatalf("b incoming: %v", l)
	}
	_, l = get(t, ts, "/api/v1/contacts/requests", aTok)
	if got := ids(l["outgoing"], "id"); len(got) != 1 || got[0] != bID {
		t.Fatalf("a outgoing: %v", l)
	}

	// SILENT decline: gone for b, still "pending" for a, resend is a no-op
	if c, _ := post(t, ts, "/api/v1/contacts/requests/"+aID+"/decline", `{}`, bTok); c != 204 {
		t.Fatalf("decline: %d", c)
	}
	_, l = get(t, ts, "/api/v1/contacts/requests", bTok)
	if len(l["incoming"].([]any)) != 0 {
		t.Fatalf("declined request visible to the target: %v", l)
	}
	_, l = get(t, ts, "/api/v1/contacts/requests", aTok)
	if len(l["outgoing"].([]any)) != 1 {
		t.Fatalf("decline leaked to the requester: %v", l)
	}
	if c, _ := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok); c != 200 {
		t.Fatalf("resend after decline must look identical: %d", c)
	}
	if c, _ := post(t, ts, "/api/v1/contacts/requests/"+aID+"/accept", `{}`, bTok); c != 404 {
		t.Fatalf("declined request must not be acceptable: %d", c)
	}

	// b changes their mind by adding a back → instant mutual
	c, b = post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, aID), bTok)
	if c != 201 || b["relationship"] != "contact_mutual" || b["contact"] == nil {
		t.Fatalf("reverse collapse: %d %v", c, b)
	}
	if c, _ := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, aID), bTok); c != 409 {
		t.Fatalf("request to a contact: %d", c)
	}
	for _, tok := range []string{aTok, bTok} {
		if _, l := get(t, ts, "/api/v1/contacts", tok); len(l["contacts"].([]any)) != 1 {
			t.Fatalf("both sides must list the contact: %v", l)
		}
	}
	if c, _ := post(t, ts, "/api/v1/contacts",
		`{"userId":"00000000-0000-0000-0000-000000000000"}`, aTok); c != 404 {
		t.Fatalf("unknown target: %d", c)
	}
}

func TestContactRequests_CancelAndAuth(t *testing.T) {
	ts, st, sender, aTok, aID, bTok, bID := setupTwoUsers(t)
	cTok, _ := mkUser(t, ts, st, sender, "carol@x.io", "carol#0003")

	post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	// a third party can neither accept nor cancel someone else's request
	if c, _ := post(t, ts, "/api/v1/contacts/requests/"+aID+"/accept", `{}`, cTok); c != 404 {
		t.Fatalf("third-party accept: %d", c)
	}
	if del(t, ts, "/api/v1/contacts/requests/"+bID, cTok) != 404 {
		t.Fatal("third-party cancel")
	}
	// the requester cannot accept their own request
	if c, _ := post(t, ts, "/api/v1/contacts/requests/"+bID+"/accept", `{}`, aTok); c != 404 {
		t.Fatalf("self accept: %d", c)
	}
	if del(t, ts, "/api/v1/contacts/requests/"+bID, aTok) != 204 {
		t.Fatal("cancel")
	}
	if del(t, ts, "/api/v1/contacts/requests/"+bID, aTok) != 404 {
		t.Fatal("cancel twice")
	}
	_, l := get(t, ts, "/api/v1/contacts/requests", bTok)
	if len(l["incoming"].([]any)) != 0 {
		t.Fatalf("cancelled request still incoming: %v", l)
	}
	if c, _ := get(t, ts, "/api/v1/contacts/requests", ""); c != 401 {
		t.Fatalf("unauthenticated: %d", c)
	}
}

func TestContactRequests_RateLimited(t *testing.T) {
	g := generousLimits()
	g.ContactRequest = api.RateLimitSpec{PerMinute: 1, Burst: 2}
	ts, st, sender := newLimitedServerFull(t, g)
	aTok, _ := mkUser(t, ts, st, sender, "a@x.io", "a#0001")
	_, b1 := mkUser(t, ts, st, sender, "b1@x.io", "b1#0002")
	_, b2 := mkUser(t, ts, st, sender, "b2@x.io", "b2#0003")
	_, b3 := mkUser(t, ts, st, sender, "b3@x.io", "b3#0004")

	for _, id := range []string{b1, b2} {
		if c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, id), aTok); c != 201 {
			t.Fatalf("within burst: %d %v", c, b)
		}
	}
	c, b := post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, b3), aTok)
	if c != 429 || errCode(b) != "rate_limited" {
		t.Fatalf("over burst: %d %v", c, b)
	}
}

func readUntil(t *testing.T, c interface{ Close() error }, read func() wsFrame, typ string) wsFrame {
	t.Helper()
	for i := 0; i < 10; i++ {
		if f := read(); f.Type == typ {
			return f
		}
	}
	t.Fatalf("never received %s", typ)
	return wsFrame{}
}

// every consent event reaches the right device — and decline reaches nobody
// but the decliner's own devices.
func TestContactRequests_WSEvents(t *testing.T) {
	ts, st, sender, hub := newServerWS(t)
	hub.OfflineGrace = time.Hour
	aTok, aID := mkUser(t, ts, st, sender, "wa@x.io", "wa#0001")
	bTok, bID := mkUser(t, ts, st, sender, "wb@x.io", "wb#0002")

	ac, _ := wsConnect(t, ts, aTok, 0)
	defer func() { _ = ac.Close() }()
	bc, _ := wsConnect(t, ts, bTok, 0)
	defer func() { _ = bc.Close() }()
	aRead := func() wsFrame { return wsRead(t, ac) }
	bRead := func() wsFrame { return wsRead(t, bc) }

	// request → target only
	post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	ev := readUntil(t, bc, bRead, "contact.request")
	if ev.Data["user"].(map[string]any)["id"] != aID {
		t.Fatalf("contact.request payload: %v", ev.Data)
	}

	// cancel → target is told, requester's other devices resolve
	del(t, ts, "/api/v1/contacts/requests/"+bID, aTok)
	readUntil(t, bc, bRead, "contact.request.withdrawn")
	readUntil(t, ac, aRead, "contact.request.resolved")

	// accept → BOTH get contact.accepted carrying the other party
	post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	readUntil(t, bc, bRead, "contact.request")
	post(t, ts, "/api/v1/contacts/requests/"+aID+"/accept", `{}`, bTok)
	if e := readUntil(t, ac, aRead, "contact.accepted"); e.Data["user"].(map[string]any)["id"] != bID {
		t.Fatalf("a accepted payload: %v", e.Data)
	}
	if e := readUntil(t, bc, bRead, "contact.accepted"); e.Data["user"].(map[string]any)["id"] != aID {
		t.Fatalf("b accepted payload: %v", e.Data)
	}

	// unfriend → both sides drop the contact
	del(t, ts, "/api/v1/contacts/"+bID, aTok)
	if e := readUntil(t, bc, bRead, "contact.removed"); e.Data["userId"] != aID {
		t.Fatalf("b removed payload: %v", e.Data)
	}
	if e := readUntil(t, ac, aRead, "contact.removed"); e.Data["userId"] != bID {
		t.Fatalf("a removed payload: %v", e.Data)
	}

	// decline is SILENT for the requester
	post(t, ts, "/api/v1/contacts", fmt.Sprintf(`{"userId":%q}`, bID), aTok)
	readUntil(t, bc, bRead, "contact.request")
	post(t, ts, "/api/v1/contacts/requests/"+aID+"/decline", `{}`, bTok)
	readUntil(t, bc, bRead, "contact.request.resolved") // decliner's own devices
	_ = ac.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	var f wsFrame
	if err := ac.ReadJSON(&f); err == nil {
		t.Fatalf("requester must receive nothing on decline, got %s %v", f.Type, f.Data)
	}
}
