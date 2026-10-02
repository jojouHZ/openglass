// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"bytes"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/jojouHZ/openglass/internal/store"
)

// Attachments — contract: docs/api/public-api.openapi.yaml.
// Blobs live on disk under cfg.UploadsDir; metadata in the store.
// Membership in the attachment's chat is required for both upload and
// download; non-members get 404 (existence-privacy).

const uploadMaxBytes = 25 << 20 // 25 MiB — contract limit

// uploadAttachment — POST /chats/{chatId}/attachments (multipart file).
func (s *Server) uploadAttachment(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("chatId")
	uid := userID(r)
	ok, err := s.chats.IsChatMember(r.Context(), chatID, uid)
	if err != nil || !ok {
		notFound(w)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, uploadMaxBytes)
	f, hdr, err := r.FormFile("file")
	if err != nil {
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			writeErr(w, http.StatusRequestEntityTooLarge, "too_large",
				"File exceeds 25 MiB", nil)
			return
		}
		badRequest(w, "Validation failed",
			map[string]any{"file": "required"})
		return
	}
	defer func() { _ = f.Close() }()

	// Sniff the real content type — never trust the client header.
	head := make([]byte, 512)
	n, _ := io.ReadFull(io.LimitReader(f, 512), head)
	mime := http.DetectContentType(head[:n])
	kind := "file"
	if strings.HasPrefix(mime, "image/") {
		kind = "photo"
	}

	id := newUUID()
	path := filepath.Join(s.cfg.UploadsDir, id)
	// #nosec G304 -- path is UploadsDir + a server-minted uuid, no user input
	out, err := os.Create(path)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", "Upload failed", nil)
		return
	}
	size, err := io.Copy(out, io.MultiReader(bytes.NewReader(head[:n]), f))
	cerr := out.Close()
	if err != nil || cerr != nil {
		_ = os.Remove(path)
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			writeErr(w, http.StatusRequestEntityTooLarge, "too_large",
				"File exceeds 25 MiB", nil)
			return
		}
		writeErr(w, http.StatusInternalServerError, "internal", "Upload failed", nil)
		return
	}

	a, err := s.chats.CreateAttachment(r.Context(), &store.Attachment{
		ChatID:      chatID,
		UploaderID:  uid,
		Kind:        kind,
		MimeType:    mime,
		FileName:    filepath.Base(hdr.Filename),
		SizeBytes:   size,
		StoragePath: path,
	})
	if err != nil {
		_ = os.Remove(path)
		writeErrorFromErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"attachment": attachmentJSON(a)})
}

// downloadAttachment — GET /attachments/{attachmentId}.
func (s *Server) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	a, err := s.chats.AttachmentByID(r.Context(), r.PathValue("attachmentId"))
	if err != nil {
		notFound(w)
		return
	}
	ok, err := s.chats.IsChatMember(r.Context(), a.ChatID, userID(r))
	if err != nil || !ok || a.StoragePath == "" {
		notFound(w)
		return
	}
	w.Header().Set("Content-Type", a.MimeType)
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename*=UTF-8''%s", percentQuote(a.FileName)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, a.StoragePath)
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// percentQuote — RFC 5987 filename* encoding (minimal: escape %, quotes, non-ASCII).
func percentQuote(s string) string {
	var sb strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '.' || c == '-' || c == '_' {
			sb.WriteByte(c)
		} else {
			fmt.Fprintf(&sb, "%%%02X", c)
		}
	}
	return sb.String()
}
