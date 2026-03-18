FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY server.js ./
COPY public/ ./public/

# Games and emu dirs (will be mounted as volumes in production)
RUN mkdir -p public/games public/emu

# Non-root user for security
RUN addgroup -S retro && adduser -S retro -G retro
RUN chown -R retro:retro /app
USER retro

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]