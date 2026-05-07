# Use Node 22 slim image
FROM node:22-slim AS builder

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build the project
RUN npm run build

# --- Production Stage ---
FROM node:22-slim

WORKDIR /app

# Copy only production files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/package-lock.json ./

# Install only production dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && npm ci --omit=dev \
    && rm -rf /var/lib/apt/lists/*

# Create data directory
RUN mkdir -p data

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Run the app
CMD ["node", "dist/index.js"]
