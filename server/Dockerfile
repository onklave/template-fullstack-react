# syntax=docker/dockerfile:1
#
# Image for the `api` service. Its build context is server/ (see onklave.yaml),
# so nothing outside this directory is visible to it — the api image cannot
# accidentally pick up client source, and vice versa.
#
# Node 24 ("Krypton") is the Active LTS line, supported until 2028-04-30.

# --- Build stage: production dependencies only ---
FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# --- Runtime stage ---
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `node` (uid 1000) ships with the image; nothing here needs root.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node
EXPOSE 8080

# Writes nothing to disk: the container is replaced on every deploy, and all
# state lives in the database reached through DATABASE_URL.
CMD ["node", "src/server.js"]
