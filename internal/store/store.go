// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package store — auth-layer persistence.
//
// Store is the consumer-facing interface (used by internal/api);
// PG implements it over pgx, Mem backs contract tests.
package store

import (
	"context"
	"errors"
	"time"
)

// Domain types — field names mirror the API contract (camelCase JSON
// handled at the api boundary, these stay Go-shaped).

type User struct {
	ID          string
	Email       string
	DisplayName string // "" until completeProfile
	Tag         string // "" until bound
	AvatarURL   *string
	CreatedAt   time.Time
}

type OtpRecord struct {
	Email        string
	CodeHash     string
	AttemptsLeft int
	ExpiresAt    time.Time
	NextResendAt time.Time
	InviteCode   *string // pending invite — consumed at verify
}

type Session struct {
	ID         string
	UserID     string
	DeviceName string
	CreatedAt  time.Time
	LastSeenAt time.Time
}

var (
	ErrNotFound  = errors.New("not found")
	ErrConflict  = errors.New("conflict")
	ErrConsumed  = errors.New("invite consumed")
	ErrForbidden = errors.New("forbidden")
)

// AuthStore — the persistence surface the API layer needs.
// Kept narrow on purpose: chat/message ops join with their slices.
type AuthStore interface {
	// users
	UserByEmail(ctx context.Context, email string) (*User, error)
	UserByID(ctx context.Context, id string) (*User, error)
	TagExists(ctx context.Context, tag string) (bool, error)
	CreateUser(ctx context.Context, email string) (*User, error)
	CompleteProfile(ctx context.Context, userID, displayName, tag string) (*User, error)
	UpdateProfile(ctx context.Context, userID string, displayName *string, avatarURL *string) (*User, error)
	SearchUsers(ctx context.Context, q string, limit int) ([]User, error)

	// invites
	InviteValid(ctx context.Context, code string) (bool, error)
	ConsumeInvite(ctx context.Context, code string) error // inside verify tx

	// otp
	SaveOtp(ctx context.Context, rec *OtpRecord) error
	OtpFor(ctx context.Context, email string) (*OtpRecord, error)
	DeleteOtp(ctx context.Context, email string) error
	DecrementOtpAttempts(ctx context.Context, email string) (int, error)

	// sessions
	CreateSession(ctx context.Context, userID, deviceName string, refreshHash []byte) (*Session, error)
	SessionByRefreshHash(ctx context.Context, hash []byte) (*Session, bool /*revoked*/, error)
	RotateSessionRefresh(ctx context.Context, sessionID string, newHash []byte) error
	RevokeSession(ctx context.Context, sessionID string) error
	// SessionActive — false when revoked or absent (middleware gate).
	SessionActive(ctx context.Context, sessionID string) (bool, error)
	ListSessions(ctx context.Context, userID, currentID string) ([]Session, error)
}

// ---- Messaging domain (phase B) ----

type Contact struct {
	User       User
	Mutual     bool
	AddedAt    time.Time
	VerifiedAt *time.Time // private layer writes; always nil for now
}

type MemberRights struct {
	InviteMembers  bool `json:"inviteMembers,omitempty"`
	RemoveMembers  bool `json:"removeMembers,omitempty"`
	EditInfo       bool `json:"editInfo,omitempty"`
	PinMessages    bool `json:"pinMessages,omitempty"`
	DeleteMessages bool `json:"deleteMessages,omitempty"`
}

type GroupMember struct {
	User     User
	Role     string // owner|member
	Rights   MemberRights
	JoinedAt time.Time
}

type Chat struct {
	ID        string
	Type      string // direct|group
	Title     *string
	Peer      *User         // direct chats only
	Members   []GroupMember // group chats only
	CreatedAt time.Time
}

type ChatSummary struct {
	Chat
	LastMessage    *Message
	LastActivityAt time.Time
	UnreadCount    int
	MemberCount    int
	Pinned         bool // viewer-side pin
}

type Attachment struct {
	ID          string
	ChatID      string
	UploaderID  string
	Kind        string // photo|file
	MimeType    string
	FileName    string
	SizeBytes   int64
	StoragePath string // "" until uploaded (#16)
	CreatedAt   time.Time
}

type Message struct {
	ID               string
	ChatID           string
	Seq              int64
	SenderID         string
	Text             *string
	Attachments      []Attachment
	ReplyToMessageID *string
	ClientNonce      string
	SentAt           time.Time
	EditedAt         *time.Time
	DeletedAt        *time.Time
	Pinned           bool
}

// MessageQuery — cursor semantics per openapi listMessages.
type MessageQuery struct {
	Limit    int
	Before   *int64 // opaque cursor = seq boundary toward older
	After    *int64 // toward newer (after `around` jump)
	AroundID string // message uuid — window centered on its seq
	Q        string // full-text, min 2 chars; results seq desc
	Pinned   bool   // pinned-only view
}

// ChatStore — messaging persistence surface.
// Convention: ErrNotFound also means "chat exists but caller is not a
// member" — existence of foreign chats is never leaked (contract 404).
type ChatStore interface {
	// contacts
	ListContacts(ctx context.Context, userID string) ([]Contact, error)
	AddContact(ctx context.Context, userID, contactID string) (*Contact, error) // ErrConflict dup, ErrNotFound user
	RemoveContact(ctx context.Context, userID, contactID string) error          // ErrNotFound
	AreMutual(ctx context.Context, a, b string) (bool, error)
	// ContactEdges reports the two directed edges between a and b —
	// drives the relationship enum on GET /users/{id} (S7).
	ContactEdges(ctx context.Context, a, b string) (aToB, bToA bool, err error)
	MutualContactIDs(ctx context.Context, userID string) ([]string, error) // presence scope (ws)

	// chats
	ListChatSummaries(ctx context.Context, userID string) ([]ChatSummary, error)
	ChatByID(ctx context.Context, chatID, userID string) (*Chat, error) // member-view
	OpenDirectChat(ctx context.Context, me, peerID string) (*Chat, bool /*created*/, error)
	SetChatPinned(ctx context.Context, chatID, userID string, pinned bool) error // ErrNotFound non-member
	IsChatMember(ctx context.Context, chatID, userID string) (bool, error)
	ChatMemberIDs(ctx context.Context, chatID string) ([]string, error) // fan-out (ws)
	// Membership returns role+rights for a member — ErrNotFound hides
	// foreign chats; used for rights-gated operations (groups).
	Membership(ctx context.Context, chatID, userID string) (*GroupMember, error)

	// groups — party/raid rights model (owner implicit, member via rights)
	CreateGroup(ctx context.Context, ownerID, title string, memberIDs []string) (*Chat, error)
	SetGroupTitle(ctx context.Context, chatID, actorID, title string) (*Chat, error)
	AddGroupMembers(ctx context.Context, chatID, actorID string, memberIDs []string) error
	RemoveGroupMember(ctx context.Context, chatID, actorID, targetID string) error
	SetMemberRights(ctx context.Context, chatID, ownerID, targetID string, rights MemberRights) (*GroupMember, error)
	TransferOwnership(ctx context.Context, chatID, ownerID, newOwnerID string) error

	// messages
	ListMessages(ctx context.Context, chatID string, q MessageQuery) (msgs []Message, nextCursor, newerCursor *int64, err error)
	SendMessage(ctx context.Context, m *Message) (*Message, bool /*created*/, error) // created=false on nonce replay
	MessageByID(ctx context.Context, messageID string) (*Message, error)
	EditMessage(ctx context.Context, messageID, editorID, text string) (*Message, error) // ErrForbidden not own
	DeleteMessage(ctx context.Context, messageID, userID string) error                   // own; groups: also owner/delete_messages
	SetMessagePinned(ctx context.Context, messageID, userID string, pinned bool) (*Message, error)
	MarkRead(ctx context.Context, chatID, userID string, upToSeq int64) error
}

// Store — full persistence surface. PG and Mem both implement it.
type Store interface {
	AuthStore
	ChatStore
}
