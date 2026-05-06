# ── PhotoShare Backend Dockerfile ───────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies only layer (cached unless package.json changes)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

# Health check for Azure App Service / Container Apps
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
