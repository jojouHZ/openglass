# Slice #11 — Auth Rate Limiting

The one remaining "known gap" row in the threat model is now closed:
IP-level rate limiting on the auth endpoints, plus a per-email OTP
bucket.

## Design

- **In-memory token buckets** (`internal/api/ratelimit.go`) — same
  stance as the WS replay ring: the managed deployment is a single
  instance, so a process-local limiter is honest and adds zero
  infrastructure. Stdlib only — no new dependencies.
- **Four buckets** wired via `AuthRateLimits`/`DefaultAuthRateLimits`:

  | Bucket | Key | Default | Blocks |
  |--------|-----|---------|--------|
  | `OtpRequestIP` | client IP | 20/min, burst 5 | mass-email floods from one IP |
  | `OtpRequestEmail` | email | 10/min, burst 3 | one victim's inbox via rotated IPs |
  | `OtpVerifyIP` | client IP | 30/min, burst 5 | brute force beyond per-account caps |
  | `RefreshIP` | client IP | 60/min, burst 10 | refresh hammering |

- **`clientIP`**: first `X-Forwarded-For` hop when present (operators
  terminate TLS at their own proxy, which sets it), else `RemoteAddr`.
- **Contract**: the reserved `rate_limited` code from
  `docs/api/errors.md` is now emitted — `429` + `Retry-After` +
  `details.retryAfterS`, matching the existing `otp_cooldown` shape.
- **Limits are checked before handler logic** — a rejected request still
  costs the caller a token, and failed handler attempts (403 invite
  gate) still drain the bucket. Flooding can't probe for free.
- **Buckets idle >10 min are swept** every 5 min — the map can't grow
  unbounded.
- Limits are injectable via `WithAuthRateLimits` so tests shrink bursts
  deterministically — no clock hooks, no sleeps.

## Ordering subtlety

The per-email bucket runs before the invite gate and the resend
cooldown inside `requestOtp`. A rapid resend sequence can therefore
shift from `otp_cooldown` to `rate_limited` — both are honest 429s
with retry guidance, so client UX is unchanged.

## Tests

- `ratelimit_test.go` (internal): burst-deny-retryAfter, refill,
  idle-bucket sweep.
- `ratelimit_api_test.go` (contract): IP bucket on otp/request,
  per-email bucket across *different* IPs, verify IP bucket +
  cross-IP independence, refresh IP bucket — all asserting
  `429`/`rate_limited`/`Retry-After`.

## Verified

- `go test -race ./internal/api` — all existing contract tests plus
  the new limiter coverage
- `go test ./...`, `go vet` — clean
- Threat-model row updated: "not wired" → implemented
