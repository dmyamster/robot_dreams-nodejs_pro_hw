#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/node_modules/.bin:$PATH"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"

if [ -f "$CREDS" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$CREDS"
  set +a
fi

if command -v infisical >/dev/null 2>&1; then
  exec infisical run --env="$ENV_SLUG" -- "$@"
else
  if [ -z "${DB_PASSWORD:-}" ]; then
    if [ -f "$ROOT/secrets/db_password" ]; then
      export DB_PASSWORD="$(tr -d '\r\n' < "$ROOT/secrets/db_password")"
    else
      export DB_PASSWORD="super_secret_db_pass_123"
    fi
  fi
  exec "$@"
fi
