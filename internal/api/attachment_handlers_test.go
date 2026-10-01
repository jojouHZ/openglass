// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// upload POSTs a multipart file to the chat attachments endpoint.
func upload(t *testing.T, ts *httptest.Server, chatID, tok, name string,
	content []byte) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatal(err)
	}
	_ = mw.Close()
	req, _ := http.NewRequest("POST",
		ts.URL+"/api/v1/chats/"+chatID+"/attachments", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// downloadRaw returns status + body + content-type for the blob endpoint.
func downloadRaw(t *testing.T, ts *httptest.Server, id, tok string) (int, []byte, string) {
	t.Helper()
	req, _ := http.NewRequest("GET", ts.URL+"/api/v1/attachments/"+id, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body, resp.Header.Get("Content-Type")
}

func TestAttachments_Roundtrip(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	// PNG magic bytes — kind must sniff to photo, not the client claim.
	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	code, body := upload(t, ts, chatID, aTok, "pic.png", png)
	if code != 201 {
		t.Fatalf("upload: %d %v", code, body)
	}
	att := body["attachment"].(map[string]any)
	if att["kind"] != "photo" || att["mimeType"] != "image/png" {
		t.Fatalf("sniff failed: %v", att)
	}
	attID := att["id"].(string)

	// bind into a message, then member can download the blob
	code, msg := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"n-att","attachmentIds":[%q]}`, attID), aTok)
	if code != 201 {
		t.Fatalf("send w/attachment: %d %v", code, msg)
	}
	if len(msg["message"].(map[string]any)["attachments"].([]any)) != 1 {
		t.Fatalf("attachments not bound: %v", msg)
	}
	code, blob, ct := downloadRaw(t, ts, attID, bTok)
	if code != 200 || !bytes.Equal(blob, png) || ct != "image/png" {
		t.Fatalf("download: %d ct=%s len=%d", code, ct, len(blob))
	}
}

func TestAttachments_NonMemberCannotDownload(t *testing.T) {
	ts, st, sender, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)
	code, body := upload(t, ts, chatID, aTok, "f.bin", []byte("payload"))
	if code != 201 {
		t.Fatalf("upload: %d %v", code, body)
	}
	attID := body["attachment"].(map[string]any)["id"].(string)

	// stranger carol — must not learn the attachment exists
	cTok, _ := mkUser(t, ts, st, sender, "carol@x.io", "carol#0003")
	if code, _, _ = downloadRaw(t, ts, attID, cTok); code != 404 {
		t.Fatalf("non-member download: %d", code)
	}
	// stranger can't even upload into the chat
	if code, _ = upload(t, ts, chatID, cTok, "x.bin", []byte("x")); code != 404 {
		t.Fatalf("non-member upload: %d", code)
	}
}

func TestAttachments_AttachmentIdsValidatedOnSend(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	// unknown id → 400 validation_failed, not silent
	code, body := post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		`{"clientNonce":"n1","attachmentIds":["11111111-1111-4111-8111-111111111111"]}`, aTok)
	if code != 400 || errCode(body) != "validation_failed" {
		t.Fatalf("bogus id: %d %v", code, body)
	}

	// staged upload bound twice → second send fails
	code, up := upload(t, ts, chatID, aTok, "a.bin", []byte("a"))
	attID := up["attachment"].(map[string]any)["id"].(string)
	if code != 201 {
		t.Fatalf("upload: %d", code)
	}
	if code, _ = post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"n2","attachmentIds":[%q]}`, attID), aTok); code != 201 {
		t.Fatalf("first send: %d", code)
	}
	code, body = post(t, ts, "/api/v1/chats/"+chatID+"/messages",
		fmt.Sprintf(`{"clientNonce":"n3","attachmentIds":[%q]}`, attID), aTok)
	if code != 400 || errCode(body) != "validation_failed" {
		t.Fatalf("reuse id: %d %v", code, body)
	}
}

func TestAttachments_NonceReplayWithAttachment(t *testing.T) {
	ts, _, _, aTok, aID, bTok, bID := setupTwoUsers(t)
	befriend(t, ts, aTok, bTok, aID, bID)
	chatID := directChat(t, ts, aTok, bID)

	code, up := upload(t, ts, chatID, aTok, "a.bin", []byte("a"))
	if code != 201 {
		t.Fatalf("upload: %d", code)
	}
	attID := up["attachment"].(map[string]any)["id"].(string)

	payload := fmt.Sprintf(`{"clientNonce":"n-rep","attachmentIds":[%q]}`, attID)
	code, first := post(t, ts, "/api/v1/chats/"+chatID+"/messages", payload, aTok)
	if code != 201 {
		t.Fatalf("first send: %d %v", code, first)
	}
	// the attachment is now bound — a retry of the same send must still
	// return the original message instead of failing validation
	code, second := post(t, ts, "/api/v1/chats/"+chatID+"/messages", payload, aTok)
	if code != 200 {
		t.Fatalf("replay: %d %v", code, second)
	}
	m1 := first["message"].(map[string]any)
	m2 := second["message"].(map[string]any)
	if m1["id"] != m2["id"] {
		t.Fatalf("replay returned different message: %v vs %v", m1["id"], m2["id"])
	}
	if len(m2["attachments"].([]any)) != 1 {
		t.Fatalf("replayed message lost attachments: %v", m2)
	}
}
