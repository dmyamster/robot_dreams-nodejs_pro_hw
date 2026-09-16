#Етап 1
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

#Етап 2

FROM node:22-alpine AS runner

WORKDIR /app

COPY package*.json ./

RUN npm ci

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/tests ./tests
COPY --from=builder /app/vitest.config.ts ./vitest.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]