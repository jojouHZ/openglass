# Slice F1 — Contacts Consent Model (SECOND)

Goal: replace one-way `AddContact` with request → accept → mutual.
Closes the group-spam vector (B2), the invisible-contacts UI gap (B1)
and the returning-user invite confusion (B4) in one coherent model.

## Model

```
A ── POST /contacts (B) ──► contact_requests row (pending)
B ── accept ──► both contact edges created atomically → mutual
B ── decline ──► request dead; A can re-request later
No response ──► nothing visible except B's incoming-requests list
```

One-way edges stop existing: a contact is either pending or mutual.
Mutual remains the gate for direct chats and group invites.

## Schema (migration 0003)

```sql
CREATE TABLE contact_requests (
  requester_id uuid REFERENCES users(id) ON DELETE CASCADE,
  target_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id)
);
```

Accept inserts BOTH `contacts` rows in one transaction — mutual is
structural, not inferred. Existing one-way rows migrate to pending
requests (data is dev-tier anyway).

## API deltas (contract-first — openapi.yaml before code)

- `POST /contacts` → sends request (201 `contact_request`)
- `POST /contacts/requests/{userId}/accept` / `/decline`
- `GET /contacts/requests` → `{incoming, outgoing}`
- `GET /contacts` → accepted mutuals only
- `POST /groups` memberIds gate: mutuals only, members land as
  `invited` (B2 fix below)
- Errors: `request_pending` (409), `request_declined` (403)

## WS events

`contact.request` (target), `contact.accepted` (both),
`contact.declined` (requester), `group.invite` (invitee),
`group.invite.accepted` (group members), `contact.request` badge in
chat list.

## B2 — group consent

`chat_members.state`: `invited` → `member`. Invitees see a pending
invite banner/list entry, not the group. Accept → `member` + `chat.new`
for them. Decline → row removed.

## UI

- S6: "Send contact request" + pending state on results
- New: incoming-requests surface (badge on S4 + section in S6/contacts)
- S7: relationship states — stranger / outgoing pending / incoming
  pending (accept-decline buttons) / mutual
- B1: contacts list screen renders the store (`mutualContacts`)
- B4: S1 invite hint (lands with F3) + verify UserByEmail path

## Store/mem mirror

`Mem` implements identical semantics — contract tests must cover both
stores (existing `pg_test` + `mem` parity harness).

## Tests

- Contract: request→accept→mutual, decline→invisible, re-request after
  decline, group invite flow, mutual gate on `openDirectChat`.
- WS: all four events assertable.
- E2E: add `contact-flow.spec.js` — request/accept → group invite
  accept → direct chat unlock.

## Risks

- Migration on populated DB: existing one-way edges → pending requests
  (don't silently mutate consent).
- Event ordering: `contact.accepted` must reach both sides before any
  direct-chat `chat.new`.
