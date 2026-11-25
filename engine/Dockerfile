# Multi-stage Dockerfile for Crew Engine
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PORT=3800

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Builder stage
FROM base AS builder
# Install build tools needed for native module compilation (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runner stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./

# Ensure persistent data directory exists
RUN mkdir -p /app/data

EXPOSE 3800

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3800/login || exit 1

CMD ["npm", "run", "start"]
