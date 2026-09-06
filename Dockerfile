# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies 
COPY package*.json ./
RUN npm ci

# Copy configuration and source files
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

# Compile application TypeScript to /app/dist
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --chown=node:node --from=builder /app/dist ./dist

# Run as non-root user for enhanced container security
USER node

# Expose NestJS application port
EXPOSE 3000

# Start production server
CMD ["node", "dist/main"]
