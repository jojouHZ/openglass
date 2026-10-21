# 15 — Concept 07 and the device-identity decision

Phase: design brainstorm after F3 + F5 M1/M2. No product code changed in
this entry — decisions and documentation only.

## What happened
- Ten shadcn-style HTML mockups were generated from real contract data
  shapes (`docs/ux/mockups-f5/`); the owner chose **07 Slate Tabs** as
  the base and asked for dark theme, tab-bar navigation and a same-window
  private session.
- A concept package was built and rendered in Chromium
  (`docs/ux/concept-07/`): four machine-checked palettes (WCAG AA),
  navigation rules, the complete private-session flow, three background
  options (owner picked the mask pattern).
- Review against the existing docs exposed several **silent conflicts**:
  dark theme was documented as reserved for the private layer;
  zero-trace said the private IndexedDB must not survive teardown;
  the contract carried a server-side `verifiedAt`; old user stories
  (US-5.3/5.3b/5.3c/5.4) described a different private UX.

## Decisions
- Private layer is distinguished by **hue + mask glyph + pattern +
  ringed composer**, not by darkness → dark theme ships.
- Mask = layer, lock = encryption/verification status; the header shows a
  lock instead of the switch for unverified contacts.
- Verification is device-bound and persistent **in the dev PWA now**
  (slice F7): identity key, signed handshake, local pins, public-key
  directory. This makes the old per-session SAS-confirm ack unnecessary
  (an unpinned pair cannot open a session).
- Zero-trace is split: session data = zero trace; device identity + pins =
  the single persistent, per-user, wipe-on-sign-out store.
- Device lock became its own slices after the owner clarified the
  model: **F8** vault + optional lock (layers: account auth / app lock /
  vault), **F9** server device trust and step-up (device continuity, not
  IP, is the trust signal — VPN-friendly). Release-MVP gets only the
  optional lock, OTP on new device and a new-login email; wipe-after-
  failures, hardware unlock, risk-based step-up and passkey binding wait
  for desktop. Sign-out wipes identity until the vault exists, then
  keeps the encrypted vault.
- Order: F1 → F4 on `main`; F5 core → F7 → F2-in-F5 → gate on the
  unpushed branch; merge only on owner command.

## War stories
- Headless Chromium kept losing its cache and system libraries after
  environment resets; libraries are now fetched with `apt-get download`
  into a user directory and loaded via `LD_LIBRARY_PATH` (no sudo), with
  an emoji font for the verification screens.
- A CSS data-URI pattern inside an inline `style="..."` attribute broke
  the attribute (stray `>` text); fixed by fully percent-encoding the SVG
  and dropping quotes.
