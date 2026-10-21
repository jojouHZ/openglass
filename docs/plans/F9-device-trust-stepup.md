# Slice F9 — Device Trust & Step-up Authentication (server side)

Pairs with F8 (client vault). Design principle: **device continuity is
the primary trust signal, IP is not.** VPNs, mobile networks and
corporate egress change IPs constantly; prompting on IP change trains
users to click through.

## Policy
| Situation | Reaction |
|---|---|
| Known device, valid token, any IP | silent; note in the sessions list |
| New device | email OTP, then offer a passkey |
| Known device + several anomalies (token used from two places at once, OTP-failure burst, sudden browser change) | step-up: passkey (user verification) else email code; email to the owner |
| Sensitive actions (revoke all, change email, add device, forget device) | always step-up |

Optional TOTP stays an opt-in factor, not a default step.

## Backend
- Device registry: device id bound to a WebAuthn credential (public key);
  refresh tokens bound to the device (stolen token alone is useless).
- Refresh-token rotation with reuse detection (revoke the token family).
- WebAuthn registration/assertion endpoints; step-up endpoints; "new
  login" email.
- Rate limits: keep per-email buckets primary; review per-IP buckets so
  shared VPN exits do not throttle honest users.

## MVP scope vs later
| In release MVP | After MVP |
|---|---|
| new device via email OTP (exists), sessions list (exists), **email notification on a new-device login** | passkey device binding, risk-based step-up, token binding, rotation-reuse detection, policy knobs for instance admins |

## Tests
- Contract tests per endpoint; reuse-detection; step-up required for
  sensitive actions; VPN scenario (IP change alone never prompts).

## Risks
- Largest auth change since launch; Security sign-off first.
- Do not claim "suspicious activity detection" beyond the signals
  actually implemented.
