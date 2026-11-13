# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

# BuildKit secret mount: token is never stored in image layers, config, or history
RUN --mount=type=secret,id=npm_token,target=/run/secrets/npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null || true)" \
    npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY openapi ./openapi

RUN npm run build && npm prune --omit=dev

# Stage 2: Production distroless runtime (no shell, non-root uid 65532)
FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi ./openapi
COPY --from=builder /app/package.json ./package.json

USER 65532

EXPOSE 3000

CMD ["dist/main.js"]
