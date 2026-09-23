#!/usr/bin/env bash
# Runs ON THE SERVER as the deploy user. Called by .github/workflows/staging.yml:
#   remote-deploy.sh <git sha> <domain>
# Layout (BRD §10): /srv/ecofy/releases/<sha>   /srv/ecofy/current -> release   /srv/ecofy/shared/{.env,data}
set -euo pipefail

SHA="${1:?sha}"
DOMAIN="${2:-localhost}"
ROOT="${ECOFY_ROOT:-/srv/ecofy}"
REL="$ROOT/releases/$SHA"
TARBALL="$ROOT/releases/$SHA.tgz"
SHARED="$ROOT/shared"
PORT="${PORT:-3100}"
KEEP="${KEEP_RELEASES:-5}"

log() { printf '\n==> %s\n' "$*"; }

log "Unpacking $TARBALL -> $REL"
mkdir -p "$REL" "$SHARED/data"
tar -xzf "$TARBALL" -C "$REL"
rm -f "$TARBALL"

[ -f "$SHARED/.env" ] || { echo "Missing $SHARED/.env (the workflow writes it from the STAGING_ENV_FILE secret)"; exit 1; }
ln -sfn "$SHARED/.env" "$REL/.env"
ln -sfn "$SHARED/data" "$REL/.data"

log "Installing dependencies (dev deps included: tsx runs the worker)"
cd "$REL"
npm ci --legacy-peer-deps --no-audit --no-fund

PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
log "Switching current -> $REL (previous: ${PREV:-none})"
ln -sfn "$REL" "$ROOT/current"

log "Reloading PM2"
pm2 startOrReload "$ROOT/current/ecosystem.config.cjs" --update-env
pm2 save >/dev/null

log "Health check http://127.0.0.1:$PORT/api/v1/health"
ok=""
for _ in $(seq 1 20); do
  if body="$(curl -fsS -H "Host: $DOMAIN" "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null)"; then
    ok=1
    echo "$body"
    break
  fi
  sleep 3
done

if [ -z "$ok" ]; then
  echo "Health check FAILED. Last 40 web log lines:"
  pm2 logs --nostream --lines 40 ecofy-lms || true
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$REL" ]; then
    log "Rolling back to $PREV"
    ln -sfn "$PREV" "$ROOT/current"
    pm2 startOrReload "$ROOT/current/ecosystem.config.cjs" --update-env
    pm2 save >/dev/null
  fi
  exit 1
fi

log "Pruning old releases (keeping $KEEP)"
ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

log "Deployed $SHA"
pm2 ls
