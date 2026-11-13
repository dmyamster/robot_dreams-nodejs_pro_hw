#!/usr/bin/env bash
set -euo pipefail

NS="${K8S_NAMESPACE:-broker-hw28}"
PROXY_PORT="${KUBECTL_PROXY_PORT:-18089}"
PROXY_PID=""

cleanup() {
  if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill -TERM "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

kubectl -n "$NS" rollout status deployment/broker-api --timeout=120s >/dev/null

MIN_AVAILABLE=$(kubectl -n "$NS" get pdb broker-pdb -o jsonpath='{.spec.minAvailable}')
PODS=($(kubectl -n "$NS" get pods -l app=broker-api --field-selector=status.phase=Running -o jsonpath='{.items[*].metadata.name}'))
HEALTHY=${#PODS[@]}

if [ "$HEALTHY" -lt 2 ]; then
  echo "Expected at least 2 running pods, got $HEALTHY" >&2
  exit 1
fi

kubectl proxy --port="$PROXY_PORT" >/dev/null 2>&1 &
PROXY_PID=$!

# Wait for kubectl proxy to listen
for _ in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:${PROXY_PORT}/healthz"; then
    break
  fi
  sleep 0.2
done

evict_pod() {
  local pod="$1"
  local payload
  payload=$(printf '{"apiVersion":"policy/v1","kind":"Eviction","metadata":{"name":"%s","namespace":"%s"}}' "$pod" "$NS")
  curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "http://127.0.0.1:${PROXY_PORT}/api/v1/namespaces/${NS}/pods/${pod}/eviction"
}

EVICT_1=$(evict_pod "${PODS[0]}")
EVICT_2=$(evict_pod "${PODS[1]}")

echo "healthy=$HEALTHY"
echo "minAvailable=$MIN_AVAILABLE"
echo "evict-1=$EVICT_1"
echo "evict-2=$EVICT_2"

# Wait for replacement pod to become ready so cluster stays healthy
kubectl -n "$NS" rollout status deployment/broker-api --timeout=120s >/dev/null
