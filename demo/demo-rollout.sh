#!/usr/bin/env bash
set -euo pipefail

NS="${K8S_NAMESPACE:-broker-hw28}"
PROFILE="${DEPLOY_PROFILE:-hardened}"
TARGET_URL="${TARGET_URL:-http://127.0.0.1:30080/healthz}"

CODES_FILE=$(mktemp /tmp/rollout-codes-XXXXXX.txt)
LOAD_PID=""

cleanup() {
  if [ -n "$LOAD_PID" ] && kill -0 "$LOAD_PID" 2>/dev/null; then
    kill -TERM "$LOAD_PID" 2>/dev/null || true
    wait "$LOAD_PID" 2>/dev/null || true
  fi
  rm -f "$CODES_FILE"
}
trap cleanup EXIT

# Ensure cluster is ready before starting load
kubectl -n "$NS" rollout status deployment/broker-api --timeout=120s >/dev/null

# Start load generator in background
TARGET_URL="$TARGET_URL" node scripts/load-gen.mjs "$CODES_FILE" &
LOAD_PID=$!

# Let steady-state traffic accumulate
sleep 2

START_TS=$(date +%s)
NEW_REV="rev-$(date +%s)"

# Trigger rolling update via Pulumi
DEPLOY_PROFILE="$PROFILE" REV="$NEW_REV" bash scripts/with-secrets.sh dev pulumi --cwd infra up --yes --non-interactive >/dev/null
kubectl -n "$NS" rollout status deployment/broker-api --timeout=180s >/dev/null

END_TS=$(date +%s)
ROLLOUT_SECONDS=$((END_TS - START_TS))

# Keep load running briefly after rollout completes to ensure >= 5000 requests
while [ "$(wc -l < "$CODES_FILE" | tr -d ' ')" -lt 5500 ]; do
  sleep 1
done

kill -TERM "$LOAD_PID" 2>/dev/null || true
wait "$LOAD_PID" 2>/dev/null || true
LOAD_PID=""

# Count results from the recorded codes file
read -r REQUESTS OK FAILED < <(awk '
  { total++; if ($1 == "200") ok++; else failed++; }
  END { printf "%d %d %d\n", total+0, ok+0, failed+0 }
' "$CODES_FILE")

echo "profile=$PROFILE"
echo "requests=$REQUESTS"
echo "ok=$OK"
echo "failed=$FAILED"
echo "rollout-seconds=$ROLLOUT_SECONDS"

if [ "$FAILED" -ne 0 ] || [ "$REQUESTS" -lt 5000 ]; then
  exit 1
fi
