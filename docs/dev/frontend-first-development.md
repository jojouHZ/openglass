# Frontend-First Development (FDD) — Strategy and Decisions

Status: **accepted** (owner decision, 2026-09-24)
Scope: MVP development order and mock-frontend strategy.

## Decision

OpenGlass MVP is built **frontend-first**: the Vue3+Vite MFE core and the
PWA shell are developed against a **mock API layer**, while the Go backend
is implemented in parallel against the same contract. Backend features are
then wired into the existing frontend one slice at a time.

This reverses the legacy order (backend-first), which produced complex
infrastructure without early product validation in `glass-messenger` /
`glass-next`.

## Precondition — Contract First

Frontend code does not start before the API contract exists. The contract
is the **single source of truth** for both the mock and the backend:

- `docs/api/public-api.openapi.yaml` — REST: auth, contacts, chats,
  messages, groups
- `docs/api/ws-events.md` — WebSocket event catalog
  (`message.new`, receipts, typing, presence)
- `docs/api/errors.md` — error model and codes

**No invented wire fields.** If the frontend needs a field or event that is
not in the contract, the contract is amended first. This rule comes
directly from the legacy mock-drift problem.

## Mock Architecture

```
packages/core/src/api/
  client.ts          // single ApiClient TS interface (methods + event subs)
  mock/              // MockApiClient: typed fixtures + artificial latency
  http/              // HttpApiClient + WsClient (real, added later)
```

- **MSW** (Mock Service Worker) intercepts REST at the network level;
  switching is a build flag: `VITE_API_MODE=mock|live`.
- The frontend never knows which implementation it talks to — the swap is
  transparent.
- The mock lives in the **shared core**, not in the PWA shell (shells stay
  thin per `docs/architecture/03-platforms.md`).
- **Contract tests** run the same suite against `MockApiClient` and the
  real Go backend — drift breaks the build.

## Mock Scope

The mock is a **static fixture layer, not a chat simulator**. It does not
emulate a live conversation, ordering, or reconnects. Scripted event
fixtures exist primarily for **recorded demos (GIF walkthroughs)** of the
screens.

| Scope | Policy |
|-------|--------|
| S1–S3 auth (invite → OTP → nickname/tag suggestion) | full mock |
| S6–S7 contacts (search, mutual add) | full mock |
| S4/S5 chat list + history (pagination) | full mock |
| S8–S9a groups (owner + delegatable rights) | full mock |
| S13–S15 settings, security, PWA prompts | full mock |
| WS events (typing, receipts, presence) | scripted fixtures only, for demo/GIF — no hub logic, no ordering, no TTL |
| OTP cooldown / rate limits | constants from the contract, no real timers |
| Attachments | local blob URLs, no upload pipeline |
| E2EE handshake, verify ritual (S11b), session countdown/BURN | **not mocked** — stub "private mode" UI states only |
| Outbox / offline send queue | **not mocked** — semantics fixed in contract first |
| Auth token refresh lifecycle | **not mocked** — mock issues a permanent token |

## Two PWA Hosts

The architectural rule "PWA never loads the private module"
(`docs/architecture/03-platforms.md`) stands for the product — with one
deliberate exception for internal testing:

| Host | Private module | Purpose | Audience |
|------|:-:|---------|----------|
| **pwa-mvp** | never loaded | production MVP build | real users |
| **pwa-dev** | **loaded** | real (non-mocked) private-layer E2E testing and demo | internal only |

Rationale: at MVP start the only test users are the owner and one family
member. There are no native shells yet (iOS arrives at Alpha), so a
private-module-enabled web host is the **only way to test the real private
layer end-to-end** before native platforms exist.

Constraints on `pwa-dev`:

- Separate build flag + separate deployment host — never the MVP build,
  never public.
- Ephemeral by intent: exists for the pre-Alpha window, torn down or kept
  internal once iOS shells carry the private layer.
- The security-tier indicator must show the honest tier — loading the
  private module in a browser does **not** make storage hardware-backed;
  the demo host is still server-trusted for key storage.
- Private-layer mocks remain forbidden even here: `pwa-dev` talks to the
  real relay only.

## Build Order

1. **API contract slice** — `docs/api/` (REST spec + WS catalog + errors).
2. **MFE core scaffold** + `MockApiClient` + fixtures.
3. **Screens S1–S3** on the mock (highest product risk, zero backend
   dependency).
4. **Screens S4–S5** chat list + view on fixtures.
5. In parallel: **backend skeleton**, starting with auth endpoints (they
   un-mock first).
6. **Un-mock order**: auth → contacts → messaging REST → **WS last**
   (only when the real hub exists).
7. **`pwa-dev` host** appears when the private relay/module lands —
  pre-Alpha private-layer E2E testing.

## References

- `docs/architecture/00-overview.md` — layers, development stages
- `docs/architecture/03-platforms.md` — MFE shells, private-module boundary
- `docs/ux/flows.md` — screen inventory S0–S16 the mock must serve
- Legacy rule (glass-next): "do not invent wire fields" — origin of the
  contract-first precondition
