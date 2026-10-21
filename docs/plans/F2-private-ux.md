# Slice F2 — Private Layer UX (in the new design)

Rewritten after the concept-07 review. Previous plan items **dropped**:
`k:"v"` encrypted ack, `peerConfirmed`, "SAS strip inside the pane",
verify-to-unlock inside a session. Verification now happens **before**
sessions (F7), so "both verified" is true by construction.

Order: built **inside the F5 branch, after F7**, directly in the new
design system — building it on the old styling first would be wasted
work. Visual spec: `docs/ux/concept-07/03-private-flow.html`.

## Changes

| # | Item | Implementation |
|---|------|----------------|
| B5 | Exit affordance | Header back chevron + explicit "end session" (burn with confirm) |
| F-2 | Settings sheet | `PrivateSheet` (Reka Dialog; bottom sheet on mobile, centered modal ≥ sm): lifetime presets 5 min / 15 min / 1 h, strict switch, "remember these settings" checkbox (localStorage: lifetime + strict only), plain-language "what the server sees" note |
| F-3 | Same-window sessions | S12 stops being a route: a `PrivatePane` hosted inside S5. Public composer swaps for the private one while a session is live. Routes `/private/setup`, `/private/invite`, `/private/verify`, `/private` are removed |
| Header | Layer control | unverified contact → lock "Verify" chip (opens the F7 ritual card); verified → layer switch (mask + switch) |
| F-4 | View-once | Compact **vertical** switch (flame in the thumb) in the private composer; a lock sits in that slot while the contact is unverified |
| Icons | Roles | mask = layer (switch, bubble marker, pattern); lock = encryption/verification status |
| Palette | Flip | chrome switches to the private palette **when the invite is accepted**; public history recessed (60%) |
| Composer | Private only | while a session is live the composer sends privately only; writing publicly = layer off |
| Cards | In-chat states | invite sent / waiting / session started / session ended / "private session lost (reload)" as dividers & cards in the timeline |
| List | Chip | chat-list `private` chip from `PrivateRemote.watchActiveSessions()` (dev PWA only) |
| Pattern | Background | tiled mask pattern, ≤ 8–9% opacity; plain-gradient fallback setting |

## Contract impact
- `PrivateRemote` per F7 (`watchVerification`, `watchActiveSessions`, …);
  `PrivateSessionView` unchanged otherwise — snapshot whitelist holds.
- No new relay envelope kinds.

## Flow
```
S5 header: lock → ritual card → verified → switch
switch ON → PrivateSheet → invite divider ("invite sent") → peer accepts
→ chrome flips to private palette → session already verified (pinned)
→ private bubbles inline (mask glyph, view-once chip) → TTL / burn /
disconnect → pane collapses, "private session ended · N messages erased"
```

## Tests
- Component tests: header lock↔switch, composer lock↔vertical switch,
  private-only composer, every private bubble carries the mask glyph.
- Contrast test over all four palettes (`palette.mjs` → vitest).
- Hue-distinctness test: private tokens vs public tokens in both themes.
- E2E rewrite of `invite-flow.spec.js` inside S5: ritual → invite →
  accept → view-once → burn → reload shows "session lost".
- Bundle guard: pattern, private palette and all private UI stay inside
  the private chunk (`VITE_PRIVATE_MODULE`).

## Risks
- Largest surgery on S5 — the pane must not break public scroll/composer
  state.
- Mode-confusion is the main product risk: never rely on colour alone.
