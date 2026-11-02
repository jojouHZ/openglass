#!/usr/bin/env bash
# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only
#
# Ship the CURRENT working tree to the test server over SSH (the branch under
# test is deliberately not on GitHub): build both PWA variants locally, rsync
# them + the server sources, then (re)create the containers on the box.
#
#   deploy/deploy.sh deploy@177.203.48.82 openglass.space
#
# Idempotent. Secrets (.env) are generated ON the server on the first run and
# never leave it. Requires: pnpm, rsync, ssh; the box prepared by
# deploy/cloud-init.yaml or deploy/bootstrap.sh.
set -euo pipefail

HOST="${1:?usage: deploy.sh user@host domain}"
DOMAIN="${2:?usage: deploy.sh user@host domain}"
KEY="${SSH_KEY:-$HOME/.ssh/openglass_timeweb}"
REMOTE=/opt/openglass
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes)
RSYNC=(rsync -az --delete -e "ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes")
cd "$(dirname "$0")/.."

echo "== build: production PWA (no private layer, live API)"
VITE_API_MODE=live pnpm --filter @openglass/pwa build
pnpm verify:mvp-bundle

echo "== build: internal pwa-dev PWA (with the private layer)"
pnpm --filter @openglass/pwa build:dev-host

echo "== upload"
"${SSH[@]}" "$HOST" "mkdir -p $REMOTE/src $REMOTE/www/app $REMOTE/www/dev"
"${RSYNC[@]}" --exclude '*_test.go' go.mod go.sum Dockerfile cmd internal "$HOST:$REMOTE/src/"
"${RSYNC[@]}" apps/pwa/dist/ "$HOST:$REMOTE/www/app/"
"${RSYNC[@]}" apps/pwa/dist-dev/ "$HOST:$REMOTE/www/dev/"
rsync -az -e "ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes" \
  deploy/docker-compose.prod.yml "$HOST:$REMOTE/docker-compose.yml"
rsync -az -e "ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes" \
  deploy/Caddyfile "$HOST:$REMOTE/Caddyfile"

echo "== start"
"${SSH[@]}" "$HOST" "DOMAIN='$DOMAIN' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/openglass
if [ ! -f .env ]; then
  umask 077
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "OPENGLASS_JWT_SECRET=$(openssl rand -hex 48)"
  } > .env
  echo "generated .env (secrets stay on this machine)"
fi
# the domain may change between runs; the secrets must not
grep -v '^DOMAIN=' .env > .env.new || true
echo "DOMAIN=$DOMAIN" >> .env.new
mv .env.new .env
chmod 600 .env
docker compose up -d --build --remove-orphans
for i in $(seq 1 40); do
  s=$(docker compose ps --format '{{.Service}} {{.Health}}' | grep -c 'healthy' || true)
  [ "$s" -ge 2 ] && break
  sleep 3
done
docker compose ps
REMOTE_SCRIPT

echo
echo "done: https://$DOMAIN  (internal build with the private layer: https://dev.$DOMAIN)"
echo "login code:    ssh $HOST 'cd $REMOTE && docker compose logs --tail 20 server | grep otp'"
echo "invite code:   ssh $HOST 'cd $REMOTE && docker compose exec server ogadmin invites create'"
