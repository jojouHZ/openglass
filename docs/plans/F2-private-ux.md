# Slice F2 — Private Layer UX Rework (THIRD)

Goal: the private layer stops being a bolt-on set of routes and becomes
a mode of the conversation itself — verify-to-unlock, in-window
messaging, honest affordances. Builds on finished F1/F3 surfaces.

## Changes

| # | Item | Implementation |
|---|------|----------------|
| B3 | **Verify-to-unlock** | New encrypted envelope `{k:"v"}` — the SAS confirm travels INSIDE AES-GCM (relay can't distinguish it). Session status gains `peerConfirmed`; messaging/send + receive-gate enable only when `ownConfirmed && peerConfirmed`. Until then the pane shows "waiting for peer verification". |
| F-2 | Setup modal | `PrivateSetupModal` inside S5 (TTL pills, strict toggle, "remember configuration" → localStorage). Routes `/private/setup` and `/private/invite` die; invite becomes an in-chat system card ("invited you to a private session — accept/decline"). |
| F-3 | Same-window sessions | Private pane overlays S5's message area in place (not a new route). S12's composer+scroll move into a `PrivatePane` component hosted by S5; the public composer swaps out while a session is live. |
| F-4 | View-once toggle | Compact switch in the private composer (icon + label), not a large button |
| F-5 | Icon | `private-toggle`: mask → lock |
| SAS | 5 emoji | Grid renders `digest[:5]`; banner hint: "compare out loud or in person — never send it in chat" |
| B5 | Exit affordance | Header: back chevron + explicit "end session" (burn with confirm) |

## Contract impact

- `MsgPayload` += `{ k: "v" }` — opaque to the relay by construction.
- `SessionView` += `peerConfirmed: boolean`; `status: "active"` only
  when both flags set (replaces "verified" as the unlocked state).
- `PrivateRemote` API unchanged otherwise — snapshot whitelist holds.
- Routes: S10/S11/S11b views fold into modal+pane; router drops the
  three `/private/*` sub-routes except the pane host.

## Flow after rework

```
S5 → lock toggle → PrivateSetupModal → invite card in the public chat
peer accepts → key exchange → SAS strip appears INSIDE the chat pane
both confirm → pane unlocks → messages flow (view-once toggle live)
TTL / burn / disconnect → pane collapses back to public composer
```

## Tests

- `store.test.ts`: `k:"v"` handling, `peerConfirmed` gating, send
  blocked before mutual confirm, re-verify after re-establishment.
- `remote.test.ts`: `peerConfirmed` in snapshot whitelist.
- E2E rewrite of `invite-flow.spec.js`: invite card → SAS strip →
  unlock → view-once → burn — all inside S5.
- Bundle guard unchanged: all private code still behind
  `VITE_PRIVATE_MODULE`.

## Risks

- Largest UX surgery of the set — S5 already hosts message rendering;
  layering a second pane must not break public scroll/composer state.
- `k:"v"` is a protocol addition: old dev clients won't understand it —
  acceptable (dev-tier, single deployment class).
