# Slice F1 — Contacts Consent Model

Goal: replace one-way `AddContact` with request → accept → mutual.
Closes the group-spam vector (B2), the invisible-contacts UI gap (B1) and
the returning-user invite confusion (B4) in one coherent model. Runs on
`main` (no redesign dependency); the Contacts tab is restyled later by
F5-M4.

## Step 0 — Dependabot alert #2 (chore)

`vite` 8.3.0–8.3.2 carries GHSA-698v-4r3x-3vcv (launch-editor
`escapeCmdArgs()` omits `%` escaping on Windows; dev-server only, patched
in **8.3.3**; Dependabot PR #45 proposes the same bump). Applied as the
first commit of this slice: bump `vite` to `8.3.3` via pnpm, verify
build/tests/bundle guard. No security-policy or release-age settings are
touched.

## Model

```
A ── POST /contacts {B} ──► contact_requests (pending)        WS contact.request → B
B ── accept ──► ONE tx: both contacts rows + request deleted  WS contact.accepted → A, B
B ── decline ──► request marked declined (SILENT)             requester still sees "pending"
A  ── resend ──► no-op while pending/declined; rate limited
A ── cancel ──► request deleted                               WS contact.request.withdrawn → B
B ── POST /contacts {A} while A→B is pending ──► auto-accept (mutual)
```

`contacts` rows now exist **only as mutual pairs** (structural: both edges
written in one transaction). Mutual remains the gate for direct chats and
group invites.

### Decisions taken in this plan (reversible, flagged for review)
1. **Silent decline.** A declined request is hidden from the requester
   (still shown as pending; a resend is a silent no-op). No rejection
   signal, no re-spam loop, nothing to leak. Replaces the old draft
   `request_declined (403)`.
2. **Group invites live in their own table** (`group_invites`), **not** as
   a `chat_members.state` column. Every existing membership query (chat
   list, fan-out, message permissions, unread counts) stays untouched, so
   an invited user can never read a group by a forgotten filter.
3. **Same silent-decline rule for group invites.**
4. **Mutual gate everywhere** (create group, add members, direct chat);
   the old gate accepted a one-way outgoing edge.
5. **Unfriend removes both edges**; existing chats are not deleted and
   message gating is unchanged (documented limitation, not part of F1).
6. **Rate limiting** reuses the in-memory token bucket from the auth
   limiter on `POST /contacts` and group invites (per user).
7. `Contact.verifiedAt` is untouched here (removed in F7).

## Schema (migration 0003)

```sql
contact_requests(requester_id, target_id, status 'pending'|'declined',
                 created_at, updated_at, PK(requester_id,target_id),
                 CHECK(requester_id <> target_id))
group_invites(chat_id, invitee_id, inviter_id, status 'pending'|'declined',
              created_at, PK(chat_id,invitee_id))
-- data: existing one-way edges become pending requests (consent is not
-- silently granted); only mutual pairs remain in contacts.
```

## API deltas (contract-first: openapi + ws-events + errors before code)

- `POST /contacts {userId}` → 201 `{relationship, request?|contact?}`
  (`contact_outgoing` or auto-accepted `contact_mutual`); 200 on an
  already-pending resend; 409 already contacts; 400 self; 404 unknown;
  429 rate limited.
- `GET /contacts` → **mutual only**.
- `GET /contacts/requests` → `{incoming: ContactRequest[], outgoing: ContactRequest[]}`
- `POST /contacts/requests/{userId}/accept` → 200 `{contact}`
- `POST /contacts/requests/{userId}/decline` → 204
- `DELETE /contacts/requests/{userId}` → 204 (cancel outgoing)
- `DELETE /contacts/{userId}` → 204 (removes both edges)
- `POST /groups`, `POST /groups/{id}/members`: members must be **mutual**;
  non-owner members become invites. `Chat.invited?: User[]` for members.
- `GET /group-invites` → `{invites: GroupInvite[]}`
- `POST /group-invites/{chatId}/accept` → 200 `{chat}`; `.../decline` → 204
- `GET /users/{id}.relationship` keeps its enum, now request-derived.

### WS events
`contact.request` (target), `contact.accepted` (both),
`contact.request.withdrawn` (target), `contact.request.resolved` (actor's
other devices), `contact.removed`, `group.invite` (invitee),
`group.invite.resolved` (invitee's other devices), `chat.new` /
`chat.updated` on accept. `contact.added` is retired.

## Frontend
- Core: contacts store gains `incoming`/`outgoing`, `sendRequest`,
  `accept`, `decline`, `cancel`, `requestCount`; chats store gains
  `invites`, `acceptInvite`, `declineInvite`; WS handlers; mock client and
  generated schema updated together.
- PWA (current styling): **Contacts root** (`/contacts`: requests, sent,
  contacts), S6 relationship-aware actions, S7 states (stranger /
  outgoing / incoming with Accept·Decline / mutual), S4 header badge +
  "Group invitations" strip, S8/S9a pickers use mutuals and show invited.
  F5-M4 later moves Contacts under the tab bar (concept 07).
- B4: S1 hint already shipped (F3); returning-user path covered by an E2E.

## Security
- Request spam: per-user bucket + silent decline + no stranger can reach
  a group without accepting.
- Existence privacy: invitees get 404 for the group until they accept
  (invites are not memberships); decline reveals nothing.
- No new PII in events; user objects only.

## Tests
- Store (pg + mem parity): request→accept→mutual, silent decline, resend
  no-op, cancel, reverse auto-accept, migration of one-way edges,
  unfriend, group invite → accept/decline, mutual gate on direct chat and
  group create/add, invitee 404.
- API/WS: all endpoints and every event assertable.
- Core: store + mock contract tests. PWA: view tests.
- E2E `contact-flow.spec.js`: request → accept → direct chat; group invite
  accept; non-contact invite impossible.

## Carried
- B13 own-bubble alignment (fixed `3038a79`); unit tests for `headerTarget`
  and `signOut` added alongside the contact screens.
