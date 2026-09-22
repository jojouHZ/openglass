# Screen prototypes

Production-shaped HTML+CSS references for every app screen — text
placeholders only, no JS. These are the canonical component sources that
get copied into the frontend (Vue SFCs) as implementation proceeds.

- `base.css` — tokens + shared component classes mirroring the Penpot
  kit 1:1 (`components.md` is the spec; class names match `ui/*` names)
- One file per screen, mobile-first (390×844) with a `@media ≥1024`
  desktop layout baked in (centered card for auth, two-pane for app)
- Icons are inline Lucide SVGs (stroke 1.25); `flame` is the only filled
  icon
- Every screen carries a `.dev-note` with its data contract
- Bubble grid per `components.md → ui/msg-bubble`: `.msg` row =
  avatar slot + `.bubble` (`.head?` sender/chip/privacy, `.body`,
  `.foot` time+state) + optional `.reaction-tray` sibling;
  `.msg.last` shows the avatar — last of a same-sender series only

| File | Screen |
|------|--------|
| s0-entry.html | Auth gate |
| s1-invite-email.html | Invite + email (self-contained, pre-base.css) |
| s2-otp.html | OTP code entry |
| s3-profile-setup.html | Display name + immutable tag |
| s4-chat-list-empty.html | Chat list empty state |
| s4b-chat-list.html | Chat list populated + folders + bottom-nav |
| s5-chat-view.html | 1:1 chat |
| s5a-message-menu.html | Context menu on message |
| s5b-pinned-search.html | Pinned bar + search highlight |
| s5c-chat-offline.html | Offline: banner + queued messages + degraded composer |
| s5d-composer-states.html | Composer strips: reply / edit / attachment / size error |
| s6-contact-search.html | Contact search by tag/name |
| s7-contact-profile.html | Contact detail + labels + actions |
| s8-group-creation.html | Group create + member pick |
| s9-group-chat.html | Group chat (sender header in bubble) |
| s9a-group-management.html | Members + permission chips |
| s9b-group-readonly.html | Group chat for member without post rights |
| s10-private-invite.html | Private session sheet + TTL wheel |
| s11-session-setup.html | In-chat invite system-card |
| s11b-verify.html | Device-pair verification ritual (emoji grid / QR) |
| s12-private-chat.html | Private session (dark) |
| s13-settings.html | Profile & settings |
| s14-security.html | Sessions + device-pair verification |
| s15-pwa-prompts.html | Install / push / offline cards |
| s16-states.html | Catalog: field errors, banners, lifecycle markers, confirms |
