# Frontend Build Stage
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci --include=dev && npm cache clean --force && rm -rf ~/.npm

# Copy source and build
COPY frontend/ ./

# Build the frontend
RUN npm run build

# Backend Build Stage
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app/backend

# Install build dependencies for native modules
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get update --allow-releaseinfo-change && \
    apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Final Runtime Stage
FROM node:20-slim AS production

# Install only runtime dependencies
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get update --allow-releaseinfo-change && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    iproute2 \
    iputils-ping \
    docker.io \
    netcat-openbsd \
    wget \
    sqlite3 \
    procps \
    util-linux \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# For What's New feature
COPY package.json ./
#COPY CHANGELOG.md ./

# Copy the properly compiled backend
COPY --from=backend-build /app/backend ./backend/

# Copy built frontend assets
COPY --from=frontend-build /app/frontend/dist ./backend/public/

# Create data directory
RUN mkdir -p /data

# Set working directory to backend
WORKDIR /app/backend

# Environment variables
ENV NODE_ENV=production
ENV PORT=4999
ENV DATABASE_PATH=/data/portracker.db

# Volume for data persistence
VOLUME /data

EXPOSE 4999

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4999/api/health || exit 1

# Run the application
CMD ["node", "index.js"]
