#!/usr/bin/env bash
set -euo pipefail

IMAGE="${APP_IMAGE:-broker-api:hw28}"
DOCKERFILE="${DOCKERFILE:-docker/Dockerfile}"
TOKEN_FILE="${NPM_TOKEN_FILE:-.npm_token}"

if [ -n "${NPM_TOKEN:-}" ]; then
  TOKEN="$NPM_TOKEN"
elif [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
else
  echo "Missing $TOKEN_FILE and NPM_TOKEN env var" >&2
  exit 1
fi

STAGES=$(grep -cE '^[[:space:]]*FROM[[:space:]]+' "$DOCKERFILE")

if docker run --rm --entrypoint sh "$IMAGE" -c "exit 0" >/dev/null 2>&1; then
  SHELL_INSIDE=1
else
  SHELL_INSIDE=0
fi

RUNTIME_UID=$(docker run --rm --entrypoint /nodejs/bin/node "$IMAGE" -e "console.log(process.getuid())")

TOKEN_IN_HISTORY=$(docker history --no-trunc "$IMAGE" 2>/dev/null | grep -cF -- "$TOKEN" || true)
TOKEN_IN_CONFIG=$(docker image inspect "$IMAGE" 2>/dev/null | grep -cF -- "$TOKEN" || true)

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

docker save "$IMAGE" -o "$TMP_DIR/image.tar"
tar -xf "$TMP_DIR/image.tar" -C "$TMP_DIR"

TOKEN_IN_LAYERS=0
while IFS= read -r -d '' layer_tar; do
  LAYER_DIR="$TMP_DIR/layer_unpack"
  rm -rf "$LAYER_DIR"
  mkdir -p "$LAYER_DIR"
  tar -xf "$layer_tar" -C "$LAYER_DIR" 2>/dev/null || true
  if grep -rqF -- "$TOKEN" "$LAYER_DIR" 2>/dev/null; then
    TOKEN_IN_LAYERS=$((TOKEN_IN_LAYERS + 1))
  fi
done < <(find "$TMP_DIR" -name '*.tar' ! -name 'image.tar' -print0)

echo "stages=$STAGES"
echo "shell-inside=$SHELL_INSIDE"
echo "runtime-uid=$RUNTIME_UID"
echo "token-in-history=$TOKEN_IN_HISTORY"
echo "token-in-config=$TOKEN_IN_CONFIG"
echo "token-in-layers=$TOKEN_IN_LAYERS"
