// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/jojouHZ/openglass/internal/store"
)

// Groups — party/raid rights model. Contract: /groups in the openapi.
// Existence privacy: non-members get 404 everywhere below.

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title     string   `json:"title"`
		MemberIDs []string `json:"memberIds"`
	}
	if err := decode(r, &in); err != nil || in.Title == "" || len(in.Title) > 128 || len(in.MemberIDs) == 0 {
		badRequest(w, "title (1..128) and memberIds are required", nil)
		return
	}
	me := userID(r)
	c, err := s.chats.CreateGroup(r.Context(), me, in.Title, in.MemberIDs)
	switch {
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "memberIds must be mutual contacts", nil)
	case err != nil:
		writeErrorFromErr(w, err)
	default:
		s.emitToChat(r.Context(), c.ID, "chat.new",
			map[string]any{"chat": chatJSON(c)}) // owner only — invitees are not members yet
		s.emitInvites(r, c, me, c.Invited)
		writeJSON(w, http.StatusCreated, map[string]any{"chat": chatJSON(c)})
	}
}

func groupInviteJSON(chatID, title string, memberCount int, inviter *store.User, at time.Time) map[string]any {
	return map[string]any{
		"chatId":      chatID,
		"title":       title,
		"memberCount": memberCount,
		"inviter":     userJSON(inviter),
		"createdAt":   at.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

// emitInvites pushes group.invite to each newly invited user. Invitees get
// the invitation only — never the chat (404 until they accept).
func (s *Server) emitInvites(r *http.Request, c *store.Chat, inviterID string, invited []store.User) {
	inviter, err := s.store.UserByID(r.Context(), inviterID)
	if err != nil {
		return
	}
	title := ""
	if c.Title != nil {
		title = *c.Title
	}
	for i := range invited {
		s.emitToUsers([]string{invited[i].ID}, "group.invite", map[string]any{
			"invite": groupInviteJSON(c.ID, title, len(c.Members), inviter, time.Now())})
	}
}

func (s *Server) editGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title string `json:"title"`
	}
	if err := decode(r, &in); err != nil || in.Title == "" || len(in.Title) > 128 {
		badRequest(w, "title is required (1..128)", map[string]any{"title": "minLength"})
		return
	}
	chatID := r.PathValue("chatId")
	c, err := s.chats.SetGroupTitle(r.Context(), chatID, userID(r), in.Title)
	s.writeGroupResult(w, r, c, err, http.StatusOK)
}

func (s *Server) addGroupMembers(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MemberIDs []string `json:"memberIds"`
	}
	if err := decode(r, &in); err != nil || len(in.MemberIDs) == 0 {
		badRequest(w, "memberIds is required", nil)
		return
	}
	ctx := r.Context()
	chatID := r.PathValue("chatId")
	invitedIDs, err := s.chats.AddGroupMembers(ctx, chatID, userID(r), in.MemberIDs)
	if err != nil {
		s.writeGroupErr(w, err)
		return
	}
	// invites go only to actually-new invitees (re-adds and silent
	// declines stay quiet); members get the fresh roster
	if c, err := s.chats.ChatByID(ctx, chatID, userID(r)); err == nil {
		var fresh []store.User
		for _, id := range invitedIDs {
			if u, err := s.store.UserByID(ctx, id); err == nil {
				fresh = append(fresh, *u)
			}
		}
		s.emitInvites(r, c, userID(r), fresh)
		s.emitToChat(ctx, chatID, "chat.updated", map[string]any{"chat": chatJSON(c)})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listGroupInvites(w http.ResponseWriter, r *http.Request) {
	list, err := s.chats.ListGroupInvites(r.Context(), userID(r))
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	out := make([]any, 0, len(list))
	for i := range list {
		out = append(out, groupInviteJSON(list[i].ChatID, list[i].Title, list[i].MemberCount, &list[i].Inviter, list[i].CreatedAt))
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": out})
}

func (s *Server) acceptGroupInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	me, chatID := userID(r), r.PathValue("chatId")
	c, err := s.chats.AcceptGroupInvite(ctx, chatID, me)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	s.emitToUsers([]string{me}, "chat.new", map[string]any{"chat": chatJSON(c)})
	s.emitToUsers([]string{me}, "group.invite.resolved", map[string]any{"chatId": chatID})
	s.emitToChat(ctx, chatID, "chat.updated", map[string]any{"chat": chatJSON(c)})
	writeJSON(w, http.StatusOK, map[string]any{"chat": chatJSON(c)})
}

// declineGroupInvite is SILENT — the group's members are not told.
func (s *Server) declineGroupInvite(w http.ResponseWriter, r *http.Request) {
	me, chatID := userID(r), r.PathValue("chatId")
	err := s.chats.DeclineGroupInvite(r.Context(), chatID, me)
	if errors.Is(err, store.ErrNotFound) {
		notFound(w)
		return
	}
	if err != nil {
		writeErrorFromErr(w, err)
		return
	}
	s.emitToUsers([]string{me}, "group.invite.resolved", map[string]any{"chatId": chatID})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeGroupMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	chatID := r.PathValue("chatId")
	targetID := r.PathValue("userId")
	// roster before removal: the removed member's other devices also
	// learn the chat changed (their next fetch → 404 → drop)
	before, _ := s.chats.ChatMemberIDs(ctx, chatID)
	stale, _ := s.chats.ChatByID(ctx, chatID, userID(r)) // pre-removal fallback
	if err := s.chats.RemoveGroupMember(ctx, chatID, userID(r), targetID); err != nil {
		s.writeGroupErr(w, err)
		return
	}
	// post-removal view: the actor may have removed themselves — read
	// through any remaining member then
	var view *store.Chat
	if after, _ := s.chats.ChatMemberIDs(ctx, chatID); len(after) > 0 {
		view, _ = s.chats.ChatByID(ctx, chatID, after[0])
	}
	if view == nil {
		view = stale
	}
	if view != nil {
		s.emitToUsers(before, "chat.updated", map[string]any{"chat": chatJSON(view)})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setMemberRights(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Rights store.MemberRights `json:"rights"`
	}
	if err := decode(r, &in); err != nil {
		badRequest(w, "rights is required", nil)
		return
	}
	ctx := r.Context()
	chatID := r.PathValue("chatId")
	gm, err := s.chats.SetMemberRights(ctx, chatID, userID(r), r.PathValue("userId"), in.Rights)
	if err != nil {
		s.writeGroupErr(w, err)
		return
	}
	if c, err := s.chats.ChatByID(ctx, chatID, userID(r)); err == nil {
		s.emitToChat(ctx, chatID, "chat.updated", map[string]any{"chat": chatJSON(c)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"member": memberJSON(gm)})
}

func (s *Server) transferOwnership(w http.ResponseWriter, r *http.Request) {
	var in struct {
		NewOwnerID string `json:"newOwnerId"`
	}
	if err := decode(r, &in); err != nil || in.NewOwnerID == "" {
		badRequest(w, "newOwnerId is required", nil)
		return
	}
	ctx := r.Context()
	chatID := r.PathValue("chatId")
	if err := s.chats.TransferOwnership(ctx, chatID, userID(r), in.NewOwnerID); err != nil {
		s.writeGroupErr(w, err)
		return
	}
	if c, err := s.chats.ChatByID(ctx, chatID, userID(r)); err == nil {
		s.emitToChat(ctx, chatID, "chat.updated", map[string]any{"chat": chatJSON(c)})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeGroupErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		notFound(w)
	case errors.Is(err, store.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden", "Insufficient rights", nil)
	default:
		writeErrorFromErr(w, err)
	}
}

func (s *Server) writeGroupResult(w http.ResponseWriter, r *http.Request, c *store.Chat, err error, code int) {
	if err != nil {
		s.writeGroupErr(w, err)
		return
	}
	s.emitToChat(r.Context(), c.ID, "chat.updated", map[string]any{"chat": chatJSON(c)})
	writeJSON(w, code, map[string]any{"chat": chatJSON(c)})
}
