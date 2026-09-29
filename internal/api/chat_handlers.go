// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jojouHZ/openglass/internal/store"
)

// Contacts + chats + messages — contract: docs/api/public-api.openapi.yaml.

// ---- contacts ----

func contactJSON(c *store.Contact) map[string]any {
	return map[string]any{
		"user":       userJSON(&c.User),
		"mutual":     c.Mutual,
		"addedAt":    c.AddedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		"verifiedAt": c.VerifiedAt,
	}
}

func (s *Server) listContacts(w http.ResponseWriter, r *http.Request) {
	list, err := s.chats.ListContacts(r.Context(), userID(r))
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, contactJSON(&list[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": out})
}

func (s *Server) addContact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID string `json:"userId"`
	}
	if err := decode(r, &in); err != nil || in.UserID == "" {
		badRequest(w, "userId is required", map[string]any{"userId": "required"})
		return
	}
	c, err := s.chats.AddContact(r.Context(), userID(r), in.UserID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrConflict):
		conflict(w, "Already in contacts", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		writeJSON(w, http.StatusCreated, map[string]any{"contact": contactJSON(c)})
	}
}

func (s *Server) removeContact(w http.ResponseWriter, r *http.Request) {
	err := s.chats.RemoveContact(r.Context(), userID(r), r.PathValue("userId"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---- chats ----

func memberJSON(gm *store.GroupMember) map[string]any {
	return map[string]any{
		"user":     userJSON(&gm.User),
		"role":     gm.Role,
		"rights":   gm.Rights,
		"joinedAt": gm.JoinedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

func chatJSON(c *store.Chat) map[string]any {
	out := map[string]any{
		"id":        c.ID,
		"type":      c.Type,
		"title":     c.Title,
		"createdAt": c.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if c.Peer != nil {
		out["peer"] = userJSON(c.Peer)
	}
	if c.Members != nil {
		members := make([]any, len(c.Members))
		for i := range c.Members {
			members[i] = memberJSON(&c.Members[i])
		}
		out["members"] = members
	}
	return out
}

func summaryJSON(s *store.ChatSummary) map[string]any {
	out := chatJSON(&s.Chat)
	out["lastActivityAt"] = s.LastActivityAt.UTC().Format("2006-01-02T15:04:05Z07:00")
	out["unreadCount"] = s.UnreadCount
	out["pinned"] = s.Pinned
	if s.LastMessage != nil {
		out["lastMessage"] = messageJSON(s.LastMessage)
	}
	if s.MemberCount > 0 {
		out["memberCount"] = s.MemberCount
	}
	return out
}

func attachmentJSON(a *store.Attachment) map[string]any {
	return map[string]any{
		"id":           a.ID,
		"kind":         a.Kind,
		"mimeType":     a.MimeType,
		"fileName":     a.FileName,
		"sizeBytes":    a.SizeBytes,
		"url":          "/api/v1/attachments/" + a.ID,
		"thumbnailUrl": nil,
	}
}

func messageJSON(m *store.Message) map[string]any {
	out := map[string]any{
		"id":               m.ID,
		"chatId":           m.ChatID,
		"seq":              m.Seq,
		"senderId":         m.SenderID,
		"text":             m.Text,
		"replyToMessageId": m.ReplyToMessageID,
		"clientNonce":      m.ClientNonce,
		"sentAt":           m.SentAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		"editedAt":         m.EditedAt,
		"deletedAt":        m.DeletedAt,
		"pinned":           m.Pinned,
	}
	if m.Attachments != nil {
		atts := make([]any, len(m.Attachments))
		for i := range m.Attachments {
			atts[i] = attachmentJSON(&m.Attachments[i])
		}
		out["attachments"] = atts
	}
	return out
}

func (s *Server) listChats(w http.ResponseWriter, r *http.Request) {
	list, err := s.chats.ListChatSummaries(r.Context(), userID(r))
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, summaryJSON(&list[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": out})
}

func (s *Server) openDirectChat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID string `json:"userId"`
	}
	if err := decode(r, &in); err != nil || in.UserID == "" {
		badRequest(w, "userId is required", map[string]any{"userId": "required"})
		return
	}
	c, created, err := s.chats.OpenDirectChat(r.Context(), userID(r), in.UserID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Not mutual contacts", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		code := http.StatusOK
		if created {
			code = http.StatusCreated
		}
		writeJSON(w, code, map[string]any{"chat": chatJSON(c)})
	}
}

func (s *Server) getChat(w http.ResponseWriter, r *http.Request) {
	c, err := s.chats.ChatByID(r.Context(), r.PathValue("chatId"), userID(r))
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"chat": chatJSON(c)})
	}
}

func (s *Server) setChatPinned(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Pinned bool `json:"pinned"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, "pinned is required", nil)
		return
	}
	err := s.chats.SetChatPinned(r.Context(), r.PathValue("chatId"), userID(r), in.Pinned)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---- messages ----

func cursorPtr(s string) *int64 {
	if s == "" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil // opaque to clients; garbage → ignored
	}
	return &v
}

func cursorStr(v *int64) any {
	if v == nil {
		return nil
	}
	return strconv.FormatInt(*v, 10)
}

func (s *Server) listMessages(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("chatId")
	uid := userID(r)
	member, err := s.chats.IsChatMember(r.Context(), chatID, uid)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	if !member {
		notFound(w)
		return
	}
	qq := r.URL.Query()
	limit, _ := strconv.Atoi(qq.Get("limit"))
	mq := store.MessageQuery{
		Limit:    limit,
		Before:   cursorPtr(qq.Get("before")),
		After:    cursorPtr(qq.Get("after")),
		AroundID: qq.Get("around"),
		Q:        qq.Get("q"),
		Pinned:   qq.Get("pinned") == "true",
	}
	if mq.Q != "" && len(mq.Q) < 2 {
		badRequest(w, "q must be at least 2 characters", map[string]any{"q": "minLength"})
		return
	}
	msgs, next, newer, err := s.chats.ListMessages(r.Context(), chatID, mq)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]any, len(msgs))
	for i := range msgs {
		out[i] = messageJSON(&msgs[i])
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"messages":    out,
		"nextCursor":  cursorStr(next),
		"newerCursor": cursorStr(newer),
	})
}

func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("chatId")
	uid := userID(r)
	var in struct {
		ClientNonce      string   `json:"clientNonce"`
		Text             *string  `json:"text"`
		AttachmentIDs    []string `json:"attachmentIds"`
		ReplyToMessageID *string  `json:"replyToMessageId"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, "invalid body", nil)
		return
	}
	fields := map[string]any{}
	if in.ClientNonce == "" {
		fields["clientNonce"] = "required"
	}
	if in.Text != nil && len(*in.Text) > 8192 {
		fields["text"] = "maxLength"
	}
	if len(in.AttachmentIDs) > 10 {
		fields["attachmentIds"] = "maxItems"
	}
	hasText := in.Text != nil && *in.Text != ""
	if !hasText && len(in.AttachmentIDs) == 0 {
		fields["text"] = "required unless attachmentIds is non-empty"
	}
	if len(fields) > 0 {
		badRequest(w, "Validation failed", fields)
		return
	}
	m := &store.Message{
		ChatID:           chatID,
		SenderID:         uid,
		Text:             in.Text,
		ClientNonce:      in.ClientNonce,
		ReplyToMessageID: in.ReplyToMessageID,
	}
	for _, id := range in.AttachmentIDs {
		m.Attachments = append(m.Attachments, store.Attachment{ID: id})
	}
	got, created, err := s.chats.SendMessage(r.Context(), m)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		code := http.StatusOK // contract: nonce replay → 200, create → 201
		if created {
			code = http.StatusCreated
		}
		writeJSON(w, code, map[string]any{"message": messageJSON(got)})
	}
}

func (s *Server) editMessage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Text string `json:"text"`
	}
	if err := decode(r, &in); err != nil || in.Text == "" || len(in.Text) > 8192 {
		badRequest(w, "text is required (1..8192)", map[string]any{"text": "minLength"})
		return
	}
	m, err := s.chats.EditMessage(r.Context(), r.PathValue("messageId"), userID(r), in.Text)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Own messages only", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"message": messageJSON(m)})
	}
}

func (s *Server) deleteMessage(w http.ResponseWriter, r *http.Request) {
	err := s.chats.DeleteMessage(r.Context(), r.PathValue("messageId"), userID(r))
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Own messages only", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) setMessagePinned(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Pinned bool `json:"pinned"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, "pinned is required", nil)
		return
	}
	msg, err := s.chats.MessageByID(r.Context(), r.PathValue("messageId"))
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	member, err := s.chats.IsChatMember(r.Context(), msg.ChatID, userID(r))
	if err != nil || !member {
		notFound(w)
		return
	}
	got, err := s.chats.SetMessagePinned(r.Context(), msg.ID, in.Pinned)
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": messageJSON(got)})
}

func (s *Server) markRead(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UpToSeq int64 `json:"upToSeq"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, "upToSeq is required", nil)
		return
	}
	err := s.chats.MarkRead(r.Context(), r.PathValue("chatId"), userID(r), in.UpToSeq)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
