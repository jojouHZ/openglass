# Journal 02 — Messaging REST: contacts, chats, messages (issue #13, B1)

**Phase:** contacts + direct chats + full message lifecycle on a shared
`store.Store` interface with Mem and PostgreSQL implementations.

## Design decisions

- **Mutual-contact gate** for direct chats (both directions required),
  self-chat as `type=direct` with `peer=self` — no separate "saved"
  chat type needed; the contract stays smaller.
- **Idempotent send** via `(chat_id, sender_id, client_nonce)` unique key
  with `ON CONFLICT` — retries return the original row with HTTP 200.
- **Per-chat `seq`** allocated by `UPDATE chats.last_seq` inside the
  message transaction — no gaps, no races, and the same column later
  anchors unread cursors (`upToSeq`).
- **Opaque cursors** for pagination; `around=<id>` windows center on a
  message, with an unknown anchor defined as a tail window (parity with
  the mock is a testable requirement, not a hope).

## War stories worth teaching

1. **Mutation before authorization.** `PG.EditMessage` originally ran
   `UPDATE` *before* checking ownership — a foreign user received `403`
   *and* the text still changed. Fixed with a conditional
   `UPDATE ... WHERE sender_id=$2` and follow-up probing to split
   `404`/`403`. Lesson: in SQL paths, authorization belongs inside the
   statement, not in a surrounding if.
2. **Existence leak via error codes.** Edit/delete/pin returned `403`
   to non-members holding a message UUID — confirming the message
   exists. A shared `msgForMember` helper now resolves → checks
   membership → returns `404` first. Contract rule `404 = absent or
   invisible` is a privacy invariant.
3. **Test flakiness is usually isolation, not logic.** A persistent dev
   database made fixed refresh-token hashes collide across runs; a
   `map[string]bool` iterated for values instead of keys produced
   nonsense UUIDs. Both looked like product bugs; both were harness.

## Test surface

30+ contract tests on Mem, mirrored PG integration tests, and a live
docker smoke covering: mutual gating, nonce retry, unread math, search,
pin/edit/tombstones, stranger-404 matrix, foreign-edit non-mutation.
