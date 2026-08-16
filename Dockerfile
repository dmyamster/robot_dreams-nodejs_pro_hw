# ==========================================
# Stage 1: Build stage (builder)
# ==========================================
FROM node:22-slim AS builder

WORKDIR /app

# Optimize layer caching: copy package files first
COPY package*.json ./

# Install all dependencies including devDependencies for building
RUN npm ci

# Copy TypeScript config and source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# ==========================================
# Stage 2: Production runtime stage (runner)
# ==========================================
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --from=builder --chown=node:node /app/dist ./dist

# Healthcheck hitting the /health endpoint
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run as non-root user
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
