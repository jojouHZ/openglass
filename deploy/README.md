# Test server (Timeweb VPS) — runbook

One box, Docker only: Caddy (80/443, automatic TLS) → Go server → Postgres + Redis.
Nothing but Caddy listens on the host; the dev compose (published DB ports) is
**not** used here.

| URL | What |
|-----|------|
| `https://openglass.space` | production PWA build (no private layer) |
| `https://dev.openglass.space` | internal `pwa-dev` build (with the private layer) |

DNS: A records for both names → the server IP, Cloudflare **DNS only** (grey cloud).

## First time
1. Create the VPS (Ubuntu 24.04), add the deploy public key.
2. Prepare it: paste `cloud-init.yaml` into the provider's cloud-init field, **or**
   run `ssh root@IP 'bash -s' < deploy/bootstrap.sh` (same steps; Docker, `deploy` user,
   ufw 22/80/443, fail2ban, 1 GB swap, key-only SSH).
3. `deploy/deploy.sh deploy@IP openglass.space`

## Update
Re-run `deploy/deploy.sh deploy@IP openglass.space` from the working tree you want to
test (branches need not be pushed). Secrets in `/opt/openglass/.env` are generated on
the server once and kept.

## Day to day
```
S='ssh deploy@IP "cd /opt/openglass && docker compose'
$S logs --tail 30 server | grep otp"          # login codes (no e-mail sender yet)
$S exec -T server ogadmin invites create"       # one invite (30 days)
$S exec -T server ogadmin reports list"         # user reports
```

## Demo access (showing the app to a guest)
- **Master invite:** `ogadmin invites create --uses 50 --days 30` (reusable, max 30 days).
- **Master code:** set `DEMO_OTP` (6 digits) and `DEMO_EMAIL_SUFFIX` (e.g. `@demo.openglass.space`)
  in `/opt/openglass/.env`, then `docker compose up -d`. The code then completes the login
  **only** for addresses ending in that suffix (fake mailboxes), so a guest types e.g.
  `guest1@demo.openglass.space` + the master invite + the master code. Real addresses are
  never affected, invites and attempt limits still apply, and the server refuses to start
  with this setting outside `OPENGLASS_DEV_MODE=1`.
- Remove both lines (and recreate the container) when the demo is over.

## Known limits
- No e-mail sender yet (the provider also blocks outbound SMTP ports 25/465/587/2525 — a
  mail API over HTTPS is the way). Codes go to the server log; the server runs in dev mode.
- Test data only; wipe with `docker compose down -v`.
