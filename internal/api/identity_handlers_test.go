// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// F7 identity-key directory contract tests (Mem).
package api_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var testPubKey = base64.StdEncoding.EncodeToString(make([]byte, 65))

// putKey — PUT with auth + JSON body (mirrors post/del helpers).
func putKey(t *testing.T, ts *httptest.Server, path, body, tok string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("PUT", ts.URL+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&m)
	return resp.StatusCode, m
}

func TestIdentityKeys_PublishListRevoke(t *testing.T) {
	ts, st, sender := newServer(t)
	tok, _ := mkUser(t, ts, st, sender, "dev@x.io", "dev#0001")

	put := func(keyID, pub, label string) (int, map[string]any) {
		req := fmt.Sprintf(`{"keyId":%q,"publicKey":%q,"label":%q}`, keyID, pub, label)
		return putKey(t, ts, "/api/v1/users/me/identity-keys", req, tok)
	}

	if c, b := put("k1", testPubKey, "phone"); c != 200 {
		t.Fatalf("put: %d %v", c, b)
	}
	// re-publish same key → idempotent, not a conflict
	if c, b := put("k1", testPubKey, "phone2"); c != 200 {
		t.Fatalf("re-put: %d %v", c, b)
	}
	// same keyId, different key → 409
	other := base64.StdEncoding.EncodeToString(append([]byte{9}, make([]byte, 64)...))
	if c, _ := put("k1", other, "x"); c != 409 {
		t.Fatalf("conflict: got %d want 409", c)
	}
	// malformed keys rejected
	for _, bad := range []string{"", "!!!", base64.StdEncoding.EncodeToString([]byte{1, 2})} {
		if c, _ := put("k2", bad, ""); c != 400 {
			t.Fatalf("bad key %q: got %d want 400", bad, c)
		}
	}

	c, b := get(t, ts, "/api/v1/users/me/identity-keys", tok)
	if c != 200 || len(b["keys"].([]any)) != 1 {
		t.Fatalf("list: %d %v", c, b)
	}
	k := b["keys"].([]any)[0].(map[string]any)
	if k["keyId"] != "k1" || k["label"] != "phone2" {
		t.Fatalf("key row: %v", k)
	}

	if c := del(t, ts, "/api/v1/users/me/identity-keys/k1", tok); c != 204 {
		t.Fatalf("revoke: %d", c)
	}
	if c := del(t, ts, "/api/v1/users/me/identity-keys/k1", tok); c != 404 {
		t.Fatalf("revoke-again: %d", c)
	}
	c, b = get(t, ts, "/api/v1/users/me/identity-keys", tok)
	if len(b["keys"].([]any)) != 0 {
		t.Fatalf("list after revoke: %v", b)
	}
}

func TestIdentityKeys_MutualOnlyRead(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)

	putKey(t, ts, "/api/v1/users/me/identity-keys",
		fmt.Sprintf(`{"keyId":"b1","publicKey":%q}`, testPubKey), bTok)

	// stranger → 404 (existence of keys must not leak)
	c, _ := get(t, ts, "/api/v1/users/"+bID+"/identity-keys", aTok)
	if c != 404 {
		t.Fatalf("stranger read: %d want 404", c)
	}

	befriend(t, ts, aTok, bTok, aID, bID)
	c, b := get(t, ts, "/api/v1/users/"+bID+"/identity-keys", aTok)
	if c != 200 || len(b["keys"].([]any)) != 1 {
		t.Fatalf("mutual read: %d %v", c, b)
	}
}
