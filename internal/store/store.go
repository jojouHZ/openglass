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
	ErrInvalid   = errors.New("invalid") // e.g. a contact request to yourself
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

// ContactRequest — a pending request, seen from either side.
type ContactRequest struct {
	User      User // the other party
	CreatedAt time.Time
}

// ContactRequestResult — outcome of RequestContact.
type ContactRequestResult struct {
	Mutual   bool            // auto-accepted: the target had already asked us
	Existing bool            // idempotent resend — nothing changed
	Request  *ContactRequest // set when !Mutual
	Contact  *Contact        // set when Mutual
}

// GroupInvite — an invitation addressed to the viewer.
type GroupInvite struct {
	ChatID      string
	Title       string
	MemberCount int
	Inviter     User
	CreatedAt   time.Time
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
	Invited   []User        // group chats only — invited, not yet joined
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
	MessageID   string // "" while staged; bound on send
	CreatedAt   time.Time
}

// SystemEvent — a structured timeline event; the client renders the sentence
// for the viewer (actor = "you" vs a name).
type SystemEvent struct {
	Type    string `json:"type"` // contact_removed
	ActorID string `json:"actorId"`
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
	Kind             string       // "" or "user" | "system"
	SystemEvent      *SystemEvent // set for kind=system
}

// redact — a retracted message keeps its place in the timeline as a
// tombstone; nothing of its content leaves the store.
func (m *Message) redact() {
	if m.DeletedAt == nil {
		return
	}
	m.Text = nil
	m.ReplyToMessageID = nil
	m.Attachments = nil
	m.Pinned = false
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
	// contacts — consent model: a contact is a mutual pair, created only by
	// accepting a request. Requests are separate rows (see 0003).
	ListContacts(ctx context.Context, userID string) ([]Contact, error) // mutual only
	// RequestContact — ErrInvalid self, ErrNotFound unknown user, ErrConflict
	// already contacts. A pending reverse request collapses into a mutual
	// contact; re-sending an existing request is a silent no-op.
	RequestContact(ctx context.Context, from, to string) (*ContactRequestResult, error)
	ListContactRequests(ctx context.Context, userID string) (incoming, outgoing []ContactRequest, err error)
	AcceptContactRequest(ctx context.Context, me, requesterID string) (*Contact, error) // ErrNotFound
	DeclineContactRequest(ctx context.Context, me, requesterID string) error            // silent; ErrNotFound
	CancelContactRequest(ctx context.Context, me, targetID string) error                // ErrNotFound
	RemoveContact(ctx context.Context, userID, contactID string) error                  // both edges; ErrNotFound
	AreMutual(ctx context.Context, a, b string) (bool, error)
	// Relationship drives GET /users/{id}: self|contact_mutual|
	// contact_outgoing|contact_incoming|none (S7).
	Relationship(ctx context.Context, a, b string) (string, error)
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
	// CreateGroup — memberIDs must be mutual contacts (ErrForbidden); they
	// become INVITED, not members (Chat.Invited).
	CreateGroup(ctx context.Context, ownerID, title string, memberIDs []string) (*Chat, error)
	SetGroupTitle(ctx context.Context, chatID, actorID, title string) (*Chat, error)
	// AddGroupMembers invites mutual contacts; returns the ids newly
	// invited (members, already-invited and silently-declined are skipped).
	AddGroupMembers(ctx context.Context, chatID, actorID string, memberIDs []string) (invited []string, err error)
	ListGroupInvites(ctx context.Context, userID string) ([]GroupInvite, error)
	AcceptGroupInvite(ctx context.Context, chatID, userID string) (*Chat, error) // ErrNotFound
	DeclineGroupInvite(ctx context.Context, chatID, userID string) error         // silent; ErrNotFound
	RemoveGroupMember(ctx context.Context, chatID, actorID, targetID string) error
	SetMemberRights(ctx context.Context, chatID, ownerID, targetID string, rights MemberRights) (*GroupMember, error)
	TransferOwnership(ctx context.Context, chatID, ownerID, newOwnerID string) error

	// messages
	ListMessages(ctx context.Context, chatID string, q MessageQuery) (msgs []Message, nextCursor, newerCursor *int64, err error)
	SendMessage(ctx context.Context, m *Message) (*Message, bool /*created*/, error) // created=false on nonce replay
	// AddSystemMessage appends a structured timeline event authored by actorID
	// (bypasses the send gates — it is how the gates are explained).
	AddSystemMessage(ctx context.Context, chatID, actorID string, ev SystemEvent) (*Message, error)
	// DirectChatBetween finds the 1-1 chat of a pair, if one exists.
	DirectChatBetween(ctx context.Context, a, b string) (chatID string, ok bool, err error)
	MessageByID(ctx context.Context, messageID string) (*Message, error)
	EditMessage(ctx context.Context, messageID, editorID, text string) (*Message, error) // ErrForbidden not own
	DeleteMessage(ctx context.Context, messageID, userID string) error                   // own; groups: also owner/delete_messages
	SetMessagePinned(ctx context.Context, messageID, userID string, pinned bool) (*Message, error)
	MarkRead(ctx context.Context, chatID, userID string, upToSeq int64) error

	// attachments — metadata rows; the blob bytes live on disk and are
	// owned by the upload/serve handlers, not the store.
	// CreateAttachment stages an upload (message_id NULL); SendMessage
	// binds staged ids of the same chat+sender onto the new message.
	CreateAttachment(ctx context.Context, a *Attachment) (*Attachment, error)
	AttachmentByID(ctx context.Context, id string) (*Attachment, error) // ErrNotFound
}

// Store — full persistence surface. PG and Mem both implement it.
type Store interface {
	AuthStore
	ChatStore
}
