# Journal 08 — Groups: party/raid rights model (issue #15, B3)

**Phase:** group chats — creation, membership, granular rights,
ownership transfer, event fan-out. Backend-only; the S8/S9 screens
remain phase-A work.

## Design decisions (and why)

**Owner + member, no admin role.** The contract's rights model is a
party/raid system: `owner` is implicit superuser; `member` rows carry
five boolean rights (`inviteMembers`, `removeMembers`, `editInfo`,
`pinMessages`, `deleteMessages`). Resisting the urge to model Telegram
admin tiers kept the whole feature to one `role` column and one
`rights` jsonb — both already existed in migration 0002, so B3 shipped
with **zero schema changes**. Forward-designed schema pays off exactly
here.

**Contacts-only invites.** The spec is silent on whether
`memberIds` must be contacts. "Any userId" turns group creation into
an existence-probing spam vector (enumerate IDs, drag strangers into
groups). The owner picked the security recommendation: every invited
id must be in the *inviter's* outgoing contacts — mutual not required.
One consequence worth teaching: the gate is per-inviter, so a member
with `inviteMembers` still can't add people *they* don't know.

**Owner can't leave.** No group-delete exists, so an owner departure
would orphan the group. Simple rule: `role='owner'` rows refuse
removal; exit only via `TransferOwnership` (one tx: demote + promote).
Former owner then leaves as a normal member.

**404, not 403, for strangers.** Same existence-privacy rule as B1,
applied at the chat level: every group route answers `ErrNotFound` to
non-members, so probing group IDs leaks nothing.

## Bugs this phase actually caught

**The `LEFT JOIN` NULL trap.** `memberGate` computed
`c.type='group' AND (mm.role='owner' OR mm.rights->>$3='true')` over a
LEFT JOIN — for a non-member every `mm.*` is NULL, so the predicate is
NULL, and `Scan` into `bool` explodes with `can't scan NULL`. Worse:
in Postgres, `false OR NULL` is still NULL, so even a *member without
the right* produced NULL instead of false. One `coalesce(..., false)`
fixed the scan, but the lesson is bigger: **any predicate that mixes
LEFT JOIN columns into a boolean result must be NULL-hardened** — the
`EXISTS` form (`canDeleteMessage`) avoided this entirely by
construction.

**Check-order = information leak.** The review pass found the PG
implementations of `TransferOwnership`, `SetMemberRights`, and
`RemoveGroupMember` resolved the *target* before gating the *actor*.
A stranger passing a real member's id got `403` where the Mem store
answered `404` — the status code alone leaked "this chat exists AND
this user sits in it" (and for remove, "this user is the owner").
Fix: a shared `groupActor` gate — missing chat, non-group chat, and
non-member actor all collapse to `ErrNotFound` — runs first in every
group op. Rule worth teaching: **in privacy-sensitive code, decide
who's asking before evaluating what they asked about.**

**Mem/PG parity is a test surface.** The review also caught: Mem
pinning tombstones and foreign messages (PG filtered
`deleted_at IS NULL`, Mem didn't check membership at all for direct
chats); Mem applying `AddGroupMembers` partially when a mid-list
contact check failed; PG 403ing an idempotent re-add that Mem skipped.
Each now behaves identically — and the PG roundtrip test pins the
stranger→`ErrNotFound` contract so a future regression can't reopen
the leak.

**Ordering on self-leave.** The handler emitted `chat.updated` via
`ChatByID` *after* removing the actor — but `ChatByID` is
membership-scoped, so the leaver's own remaining devices got nothing.
Emit the pre-removal roster before delete; matches the contract and
B2's emit-then-mutate pattern.

## Reuse note for the private layer

The rights checks live in the store (`memberGate`), not handlers — so
the future private relay, which can't inspect group state server-side,
will enforce the same rules client-side while the public layer
enforces them authoritatively. Keeping rights *data* (not code) in the
row is what makes that split possible.

## Verification

- 6 contract tests + review-pass additions: rights matrix (per-right ×
  owner/member/stranger), member-target stranger probes (403→404
  leak regression), group-routes-on-direct-chat → 404, pin/delete
  rights, owner invariants, `chat.new`/`chat.updated` emits
- `TestPG_GroupRoundtrip` on live Postgres — contacts gate, grant,
  pin, transfer, leave, plus a stranger-privacy table across all six
  group ops
- Live smoke against the docker stack: full lifecycle script —
  non-contact create rejected, privacy 404s, rights grant → member
  rename + pin, transfer, former-owner leave — all green
- `go test ./...`, vet, gofmt, golangci-lint: clean
