# Error Model — OpenGlass Public API

Part of the API contract (`docs/dev/frontend-first-development.md`).
Both `MockApiClient` and the Go backend must return exactly this shape.

## Envelope

Every non-2xx response body is:

```json
{
  "error": {
    "code": "invite_invalid",
    "message": "Invite code is invalid or already used",
    "details": { "resendAvailableInS": 42 }
  }
}
```

- `code` — stable machine-readable string from the catalog below.
  Clients switch on `code`, never on `message` or HTTP status alone.
- `message` — human-readable English, safe to display (server-written;
  UI may override with localized strings keyed by `code`).
- `details` — optional, code-specific extra data.

## Codes

| code | HTTP | meaning | typical UI handling |
|------|-----:|---------|---------------------|
| `validation_failed` | 400 | field-level validation failed; `details.fields` lists them | inline form errors |
| `invite_required` | 403 | email unknown and no invite supplied — invite gates account *creation*, returning users log in without one | S1 show invite field |
| `invite_invalid` | 403 | invite code wrong or consumed | S1 inline error |
| `otp_invalid` | 403 | wrong code | S2 inline error, attempts counter |
| `otp_expired` | 403 | code expired | S2 resend prompt |
| `otp_cooldown` | 429 | resend too soon; `details.resendAvailableInS` | disable resend, countdown |
| `tag_taken` | 409 | requested tag taken; response carries `tagSuggestions` alongside `error` | S3 suggestion list |
| `unauthorized` | 401 | missing/expired access token | silent refresh → retry; else S1 |
| `forbidden` | 403 | authenticated, action not allowed (not mutual, missing group right) | toast/disabled action |
| `not_found` | 404 | resource absent or invisible | empty state |
| `conflict` | 409 | duplicate state (e.g. already in contacts) | idempotent UI, refresh |
| `rate_limited` | 429 | generic rate limit; `Retry-After` header set | backoff + toast |
| `payload_too_large` | 413 | attachment over limit | composer error |
| `internal` | 500 | server fault | generic error screen |

## WS close codes

Realtime channel uses standard WS close codes plus:

| code | meaning | client action |
|-----:|---------|---------------|
| `4401` | access token expired / invalid | refresh token, reconnect |
| `4403` | session revoked | log out to S1 |
| `4408` | no `auth` frame within 5 s | reconnect and send auth promptly |
| `4429` | connection rate-limited | exponential backoff |

## Constants

Values the mock and backend must share:

| constant | value | where used |
|----------|------:|-----------|
| `OTP_LENGTH` | 6 digits | S2 |
| `OTP_TTL_S` | 600 | S2 expiry |
| `OTP_RESEND_COOLDOWN_S` | 60 | S2 resend |
| `OTP_MAX_ATTEMPTS` | 5 | S2 lockout → `rate_limited` |
| `ACCESS_TOKEN_TTL_S` | 900 | refresh flow |
| `MESSAGE_MAX_LEN` | 8192 | composer |
| `ATTACHMENT_MAX_BYTES` | 25 MiB | composer |
| `ATTACHMENTS_PER_MESSAGE` | 10 | composer |
| `WS_PING_INTERVAL_S` | 30 | client heartbeat |
| `WS_IDLE_TIMEOUT_S` | 90 | server drop |
| `WS_REPLAY_GRACE_S` | 60 | reconnect buffer |
