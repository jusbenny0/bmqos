# Multi-stage Dockerfile for BMQOS (Next.js standalone)
FROM node:24-alpine AS build

WORKDIR /app

# Install dependencies based on package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source code and build standalone Next.js bundle
COPY . .
RUN npm run build

# Production runtime stage
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Copy Next.js standalone bundle, static files, and public assets
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# SQLite database directory (mounted as a volume in Docker Compose / production)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "server.js"]
