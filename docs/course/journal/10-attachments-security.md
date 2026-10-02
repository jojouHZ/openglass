# Journal 10 — Phase C start: supply-chain hardening + attachments (B4)

**Phase:** two workstreams — a security sprint that took the OpenSSF
Scorecard from 5.4 to 6.7, then the first B-series feature: chat
attachments end to end (backend, client, UI).

## Design decisions (and why)

**Staged attachments, bound at send.** Upload is `POST
/chats/{id}/attachments` → blob on disk under `OPENGLASS_UPLOADS_DIR`,
row with `message_id NULL`. Sending a message validates each
`attachmentIds` entry (exists, same chat, same uploader, still staged)
and binds it inside the same transaction as the message insert. Why
staged instead of file-inside-message: upload is slow and flaky, send is
cheap — a user should be able to retry a failed send without
re-uploading, and a dropped draft shouldn't strand bytes it paid for.

**Authorization lives on the attachment's chat, and misses are 404.**
Both upload and download check `IsChatMember` of the *attachment's*
chat and return `not_found` otherwise — a stranger can't distinguish
"no such attachment" from "exists but not yours" (existence-privacy,
same rule as group probing). Content type is sniffed with
`http.DetectContentType`, never the client's header; storage path is a
server-minted uuid so the on-disk name carries zero trust.

**Downloads go through the same envelope machinery — with a `blob`
escape hatch.** `HttpTransport` learned `blob?: boolean`: success
returns `res.blob()`, errors still parse the JSON envelope into
`ApiRequestError`. One transport keeps auth injection, error shape and
the MSW interception point identical to every other call.

**Blob URLs are component-scoped.** `AttachmentView` owns the fetch →
`createObjectURL` → `revokeObjectURL` cycle per mount. No global cache:
chat screens mount/unmount constantly and a leaked URL map would pin
bytes forever. The failure state is a retry, not a dead chip.

**Scorecard fixes are config, not code.** SHA-pinned actions,
digest-pinned images, hash-locked pip requirements, pinned
`govulncheck`, CodeQL for Go and JS/TS, a ruleset the scanner can
actually read. The score moved because evidence moved — the remaining
zeros (Maintained, Code-Review, Contributors, releases) are structural:
repo age, solo workflow, no releases yet. Deferred, not hidden.

## Bugs this phase actually caught

**`[]Message{*m}` silently swallowed attachments.** `attachFor` mutates
slice elements — but `SendMessage`, `MessageByID` and the nonce-replay
path all passed a *fresh copy*: `[]Message{*out}`. Attachments bound in
the transaction, persisted, then vanished from the response. List
endpoints were fine (they mutate the real slice) — only the
single-message paths lied. Live smoke caught it: the message created
but `attachments` missing. Fixed with an `attachOne` helper that copies
the row back. **Lesson: "pass a copy for safety" is a lie when the
callee's contract is mutation.**

**A SELECT missing one column killed validation.** `AttachmentByID`
didn't select `message_id`, so `a.MessageID` was always `""` and the
bound-reuse check could never fire — silently exploitable re-binding.
Adding the column then exposed the next bug immediately: a *nonce
replay* of a successful send now failed validation, because its
attachments were legitimately bound. Contract-correct fix: a bound id
is valid only when it's bound to the message this very nonce+sender+chat
would replay — checked via `MessageByID`. **Lesson: idempotency and
validation interact; check the retry path every time you add a gate.**

**Scorecard's score went *down* when we fixed branch protection.**
5.4 → 7.0 → 6.7: the previously unreadable check became countable at
partial score once the ruleset made it inspectable. A worse number
meant better visibility — read check details, not the headline.

**pgrep can kill your own shell.** `kill $(pgrep -f og-server)` matched
the grep pattern inside the shell's own command line. `pgrep -x` or a
pidfile — full-name match only.

## Status

C.1+C.2 complete: upload → staged bind → member download, verified live
(413 oversize, 404 stranger, 400 reuse/cross-uploader, 200 nonce
replay). 36 core + 34 PWA tests, Go race suite green, prod build
verified. Scorecard 6.7 with CII-Best-Practices pending the
bestpractices.dev profile going passing.
