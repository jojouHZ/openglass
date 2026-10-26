// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jojouHZ/openglass/internal/store"
)

// Contacts + chats + messages — contract: docs/api/public-api.openapi.yaml.

// ---- contacts ----

func contactJSON(c *store.Contact) map[string]any {
	return map[string]any{
		"user":       userJSON(&c.User),
		"mutual":     true, // contacts are always accepted mutual pairs
		"addedAt":    c.AddedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		"verifiedAt": c.VerifiedAt,
	}
}

func contactRequestJSON(r *store.ContactRequest) map[string]any {
	return map[string]any{
		"user":      userJSON(&r.User),
		"createdAt": r.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
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

// addContact sends a contact REQUEST (consent model). A pending reverse
// request collapses into a mutual contact; a resend is a silent no-op.
func (s *Server) addContact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID string `json:"userId"`
	}
	if err := decode(r, &in); err != nil || in.UserID == "" {
		badRequest(w, "userId is required", map[string]any{"userId": "required"})
		return
	}
	me := userID(r)
	if wait, ok := s.contactReq.allow("user|" + me); !ok {
		rateLimited(w, wait)
		return
	}
	res, err := s.chats.RequestContact(r.Context(), me, in.UserID)
	switch {
	case errors.Is(err, store.ErrInvalid):
		badRequest(w, "You cannot add yourself", map[string]any{"userId": "self"})
		return
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
		return
	case errors.Is(err, store.ErrConflict):
		conflict(w, "Already in contacts", nil)
		return
	case err != nil:
		writeErrorFromErr(w, err)
		return
	}
	ctx := r.Context()
	switch {
	case res.Mutual:
		if mu, err := s.store.UserByID(ctx, me); err == nil {
			s.emitToUsers([]string{in.UserID}, "contact.accepted", map[string]any{"user": userJSON(mu)})
		}
		s.emitToUsers([]string{me}, "contact.accepted", map[string]any{"user": userJSON(&res.Contact.User)})
		s.emitToUsers([]string{me}, "contact.request.resolved", map[string]any{"userId": in.UserID})
		writeJSON(w, http.StatusCreated, map[string]any{
			"relationship": "contact_mutual", "contact": contactJSON(res.Contact)})
	case res.Existing:
		writeJSON(w, http.StatusOK, map[string]any{
			"relationship": "contact_outgoing", "request": contactRequestJSON(res.Request)})
	default:
		if mu, err := s.store.UserByID(ctx, me); err == nil {
			s.emitToUsers([]string{in.UserID}, "contact.request", map[string]any{
				"user": userJSON(mu), "createdAt": res.Request.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00")})
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"relationship": "contact_outgoing", "request": contactRequestJSON(res.Request)})
	}
}

func (s *Server) listContactRequests(w http.ResponseWriter, r *http.Request) {
	in, out, err := s.chats.ListContactRequests(r.Context(), userID(r))
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	conv := func(list []store.ContactRequest) []any {
		o := make([]any, 0, len(list))
		for i := range list {
			o = append(o, contactRequestJSON(&list[i]))
		}
		return o
	}
	writeJSON(w, http.StatusOK, map[string]any{"incoming": conv(in), "outgoing": conv(out)})
}

func (s *Server) acceptContactRequest(w http.ResponseWriter, r *http.Request) {
	me, requester := userID(r), r.PathValue("userId")
	c, err := s.chats.AcceptContactRequest(r.Context(), me, requester)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	if mu, err := s.store.UserByID(r.Context(), me); err == nil {
		s.emitToUsers([]string{requester}, "contact.accepted", map[string]any{"user": userJSON(mu)})
	}
	s.emitToUsers([]string{me}, "contact.accepted", map[string]any{"user": userJSON(&c.User)})
	s.emitToUsers([]string{me}, "contact.request.resolved", map[string]any{"userId": requester})
	writeJSON(w, http.StatusOK, map[string]any{"contact": contactJSON(c)})
}

// declineContactRequest is SILENT: the requester receives nothing and keeps
// seeing the request as pending; only the actor's other devices are told.
func (s *Server) declineContactRequest(w http.ResponseWriter, r *http.Request) {
	me, requester := userID(r), r.PathValue("userId")
	err := s.chats.DeclineContactRequest(r.Context(), me, requester)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	s.emitToUsers([]string{me}, "contact.request.resolved", map[string]any{"userId": requester})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) cancelContactRequest(w http.ResponseWriter, r *http.Request) {
	me, target := userID(r), r.PathValue("userId")
	err := s.chats.CancelContactRequest(r.Context(), me, target)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	s.emitToUsers([]string{target}, "contact.request.withdrawn", map[string]any{"userId": me})
	s.emitToUsers([]string{me}, "contact.request.resolved", map[string]any{"userId": target})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeContact(w http.ResponseWriter, r *http.Request) {
	me, peerID := userID(r), r.PathValue("userId")
	err := s.chats.RemoveContact(r.Context(), me, peerID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		s.emitToUsers([]string{peerID}, "contact.removed", map[string]any{"userId": me})
		s.emitToUsers([]string{me}, "contact.removed", map[string]any{"userId": peerID})
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
	if c.Type == "group" {
		invited := make([]any, len(c.Invited))
		for i := range c.Invited {
			invited[i] = userJSON(&c.Invited[i])
		}
		out["invited"] = invited
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
			// contract: chat.new lands on every member's sessions before
			// that chat's first message.new (same-session seq ordering)
			s.emitToChat(r.Context(), c.ID, "chat.new",
				map[string]any{"chat": chatJSON(c)})
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
	if qq.Has("q") && mq.Q == "" {
		badRequest(w, "q must be non-empty", map[string]any{"q": "minLength 1"})
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

// EditWindow — how long after sending an author may still edit a message.
const EditWindow = 15 * time.Minute

// directGate — consent must outlive the chat: in a direct chat (saved
// messages excepted) both parties must still be mutual contacts to SEND.
// History stays readable. Non-members get ErrNotFound like everywhere else.
func (s *Server) directGate(ctx context.Context, chatID, me string) error {
	c, err := s.chats.ChatByID(ctx, chatID, me)
	if err != nil {
		return err
	}
	if c.Type != "direct" || c.Peer == nil || c.Peer.ID == me {
		return nil
	}
	ok, err := s.chats.AreMutual(ctx, me, c.Peer.ID)
	if err != nil {
		return err
	}
	if !ok {
		return store.ErrForbidden
	}
	return nil
}

func (s *Server) writeGateErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden",
			"You are no longer contacts — sending is disabled", map[string]any{"reason": "not_contacts"})
	default:
		writeErrorFromErr(w, err)
	}
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
	if err := s.directGate(r.Context(), chatID, uid); err != nil {
		s.writeGateErr(w, err)
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
		// Contract: each id must be a staged upload in this chat by this
		// sender — anything else is validation_failed, never silent.
		a, err := s.chats.AttachmentByID(r.Context(), id)
		if err != nil || a.ChatID != chatID || a.UploaderID != uid {
			badRequest(w, "Validation failed",
				map[string]any{"attachmentIds": "invalid attachment reference"})
			return
		}
		if a.MessageID != "" {
			// already bound — valid only as a nonce replay of that send
			bm, berr := s.chats.MessageByID(r.Context(), a.MessageID)
			if berr != nil || bm.ClientNonce != in.ClientNonce ||
				bm.SenderID != uid || bm.ChatID != chatID {
				badRequest(w, "Validation failed",
					map[string]any{"attachmentIds": "invalid attachment reference"})
				return
			}
		}
		m.Attachments = append(m.Attachments, *a)
	}
	got, created, err := s.chats.SendMessage(r.Context(), m)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		if created {
			s.emitToChat(r.Context(), chatID, "message.new", messageJSON(got))
		}
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
	// invisible to non-members — 404, not 403 (existence must not leak)
	m, _ := s.msgForMember(w, r)
	if m == nil {
		return
	}
	// consent outlives the chat: a chat whose pair stopped being contacts is
	// frozen — no edits (own messages can still be retracted via delete)
	if err := s.directGate(r.Context(), m.ChatID, userID(r)); err != nil {
		s.writeGateErr(w, err)
		return
	}
	// edits are possible for a short window only: afterwards the other side
	// may already have acted on the text, and a silent rewrite is a trust
	// problem. Retract (delete → visible tombstone) and resend instead.
	if m.SenderID == userID(r) && time.Since(m.SentAt) > s.editWindow {
		writeErr(w, http.StatusForbidden, "forbidden",
			"The edit window has closed — delete the message and send a new one",
			map[string]any{"reason": "edit_window_closed", "windowMinutes": int(s.editWindow.Minutes())})
		return
	}
	m, err := s.chats.EditMessage(r.Context(), m.ID, userID(r), in.Text)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Own messages only", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		s.emitToChat(r.Context(), m.ChatID, "message.edited", messageJSON(m))
		writeJSON(w, http.StatusOK, map[string]any{"message": messageJSON(m)})
	}
}

// msgForMember resolves a messageId only for a member of its chat.
// Writes the error response and returns nil otherwise.
func (s *Server) msgForMember(w http.ResponseWriter, r *http.Request) (*store.Message, error) {
	msg, err := s.chats.MessageByID(r.Context(), r.PathValue("messageId"))
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return nil, err
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return nil, err
	}
	member, err := s.chats.IsChatMember(r.Context(), msg.ChatID, userID(r))
	if err != nil {
		writeErrorFromErr(w, err)
		return nil, err
	}
	if !member {
		notFound(w)
		return nil, store.ErrNotFound
	}
	return msg, nil
}

func (s *Server) deleteMessage(w http.ResponseWriter, r *http.Request) {
	msg, _ := s.msgForMember(w, r)
	if msg == nil {
		return
	}
	err := s.chats.DeleteMessage(r.Context(), msg.ID, userID(r))
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Own messages only", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		s.emitToChat(r.Context(), msg.ChatID, "message.deleted", map[string]any{
			"chatId": msg.ChatID, "messageId": msg.ID, "seq": msg.Seq,
		})
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
	msg, _ := s.msgForMember(w, r)
	if msg == nil {
		return
	}
	// pinning changes what both sides see — frozen once the pair is gone
	if err := s.directGate(r.Context(), msg.ChatID, userID(r)); err != nil {
		s.writeGateErr(w, err)
		return
	}
	got, err := s.chats.SetMessagePinned(r.Context(), msg.ID, userID(r), in.Pinned)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
		return
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Requires pin_messages right", nil)
		return
	case err != nil:
		writeErrorFromErr(w, err)
		return
	}
	typ := "message.unpinned"
	if in.Pinned {
		typ = "message.pinned"
	}
	s.emitToChat(r.Context(), msg.ChatID, typ, map[string]any{
		"chatId": msg.ChatID, "messageId": msg.ID,
	})
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
	chatID := r.PathValue("chatId")
	err := s.chats.MarkRead(r.Context(), chatID, userID(r), in.UpToSeq)
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		s.emitToChat(r.Context(), chatID, "receipt.read", map[string]any{
			"chatId": chatID, "userId": userID(r), "upToSeq": in.UpToSeq,
		})
		w.WriteHeader(http.StatusNoContent)
	}
}
