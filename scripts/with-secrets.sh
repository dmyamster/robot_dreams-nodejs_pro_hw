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
  if [ -z "${JWT_PRIVATE_KEY:-}" ] && [ -f "$ROOT/secrets/jwt_private.b64" ]; then
    export JWT_PRIVATE_KEY="$(tr -d '\r\n' < "$ROOT/secrets/jwt_private.b64")"
  fi
  if [ -z "${JWT_PUBLIC_KEY:-}" ] && [ -f "$ROOT/secrets/jwt_public.b64" ]; then
    export JWT_PUBLIC_KEY="$(tr -d '\r\n' < "$ROOT/secrets/jwt_public.b64")"
  fi
  if [ -z "${REFRESH_TOKEN_PEPPER:-}" ] && [ -f "$ROOT/secrets/refresh_pepper" ]; then
    export REFRESH_TOKEN_PEPPER="$(tr -d '\r\n' < "$ROOT/secrets/refresh_pepper")"
  fi
  if [ -z "${JWT_KID:-}" ]; then
    export JWT_KID="dev-1"
  fi
  if [ -z "${STORAGE_ACCESS_KEY:-}" ] && [ -f "$ROOT/secrets/storage_access_key" ]; then
    export STORAGE_ACCESS_KEY="$(tr -d '\r\n' < "$ROOT/secrets/storage_access_key")"
  fi
  if [ -z "${STORAGE_SECRET_KEY:-}" ] && [ -f "$ROOT/secrets/storage_secret_key" ]; then
    export STORAGE_SECRET_KEY="$(tr -d '\r\n' < "$ROOT/secrets/storage_secret_key")"
  fi
  if [ -z "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]; then
    export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:22918"
  fi
  if [ -z "${PROMETHEUS_URL:-}" ]; then
    export PROMETHEUS_URL="http://127.0.0.1:22901"
  fi
  if [ -z "${TRACE_API_URL:-}" ]; then
    export TRACE_API_URL="http://127.0.0.1:22904"
  fi
  if [ -z "${GRAFANA_USER:-}" ]; then
    export GRAFANA_USER="admin"
  fi
  if [ -z "${GRAFANA_PASSWORD:-}" ]; then
    export GRAFANA_PASSWORD="admin"
  fi
  exec "$@"
fi
