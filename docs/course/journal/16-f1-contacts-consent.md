# 16 — F1: contacts consent and group invitations

Slice F1 on `main` (plan: `docs/plans/F1-contacts-consent.md`). Closes the
group-spam vector (B2), the invisible-contacts screen (B1) and the
one-way contact model.

## What shipped
- **Model**: a contact request is a row the target must accept; accepting
  writes both contact edges and deletes the request in ONE transaction —
  mutual is structural, not inferred. A pending reverse request collapses
  into an immediate mutual contact.
- **Silent decline** (a design decision of this slice): a declined request
  is hidden from the target but still looks pending to the requester;
  resend is a no-op. No rejection signal, no re-spam loop. The same rule
  applies to group invitations.
- **Group invites in their own table** (`group_invites`), not a column on
  `chat_members`. Every existing membership query (chat list, fan-out,
  message permissions, unread counts) stays untouched, so an invitee
  can never read a group through a forgotten `state` filter — the shared
  store suite asserts it (404, absent from list, absent from fan-out).
- **Migration 0003** turns existing one-way edges into pending requests
  (consent is never granted silently); only mutual pairs remain in
  `contacts`. It ran against the populated dev database.
- **API/WS**: `/contacts/requests*`, `/group-invites*`, per-user rate limit
  on `POST /contacts`; events `contact.request/accepted/request.withdrawn/
  request.resolved`, `group.invite/group.invite.resolved`;
  `contact.added` is retired.
- **UI** (current styling): contacts screen (`/contacts`, alias `/search`)
  with requests / sent / contacts / global; S7 states (stranger, pending
  with resend+cancel, incoming accept/decline, mutual); S4 request badge
  and invitation strip; S9a "invited" section.
- **Chore**: vite 8.3.3 (Dependabot alert #2, GHSA-698v-4r3x-3vcv).

## Tests
- One consent suite run on BOTH stores (Mem and Postgres) — parity is the
  point; API tests for every endpoint and event; rate limit; core store
  and mock-contract tests; view tests; real-browser E2E
  (`contact-flow.spec.js`). Carried from F3: header-title navigation and
  sign-out-this-device unit tests.

## War stories
- Regenerating `schema.gen.ts` exposed that the committed OpenAPI had
  already made `User.displayName/tag` nullable (pre-profile) while the
  generated types were stale. The app-facing types now narrow users seen
  by peers back to non-null in one place (`client.ts`) instead of
  null-checking every row.
- The old Go tests encoded the one-way model (`AddContact` twice = mutual);
  the e2e-server fixture now seeds mutual pairs with two `RequestContact`
  calls, which also exercises the reverse-collapse path every run.
- Playwright's browser cache and system libraries disappeared again after
  an environment reset; browsers now live in `~/pw-browsers` and the
  missing shared libraries are loaded from `~/pwlibs`, so the real-browser
  E2E suite runs locally.

## Review follow-ups
- **Crossing-request race** found in review: two simultaneous opposite
  requests both read "no reverse request yet" and stayed pending (39 of
  40 runs on Postgres). Fixed with a per-pair transaction advisory lock;
  the regression test runs on both stores (30/30).
- **B4 claim corrected**: the plan said the returning-user path was
  covered; no test existed. Added an API test.
- **F1.1**: after unfriending, the old direct chat used to stay writable
  for both sides — the consent model was violated by the chat itself.
  Sending (messages and uploads) now needs a mutual pair (403
  `not_contacts`); S5 shows a banner and disables the composer; saved
  messages and groups are exempt.
- **Owner decisions**: contact requests never expire; later (post-MVP)
  a cap on active outgoing requests, a short note with a request and a
  "who may write to me" profile setting (with the desktop client).
- **Chore**: certifi 2026.10.19 (Dependabot alert #5, critical, affects
  only the documentation tooling).
- **F1.2 — the archive model** (owner decisions): after unfriending, the
  direct chat is a read-only archive for both sides. Audit found edit, pin
  and typing still open to an ex-contact; all three are now gated. Instead
  of a generic banner the timeline gets a **system message** (migration
  0004: `messages.kind`, `system_event`) rendered per viewer, so both
  sides learn who ended the contact and what that means. Retracting a
  message now leaves a **tombstone** (content erased in the store, shape
  kept in the timeline) and edits close after **15 minutes**.
- **CI lesson**: a test that waits a fixed 400 ms passed locally and
  failed on the slower CI runner; new tests wait for conditions
  (`vi.waitFor`). 65 older fixed waits remain — fix when touching them.
- **Review catch**: a retracted message's files were still downloadable
  by anyone who remembered the attachment id. Retraction now makes the
  blob unservable (404) on both stores; the bytes stay on disk until a
  cleanup job exists (known gap).
