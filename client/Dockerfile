# syntax=docker/dockerfile:1
#
# Image for the `web` service. Its build context is client/ (see onklave.yaml),
# so the server/ directory is not visible here — the client image physically
# cannot pick up API source or an API dependency.
#
# Node 24 ("Krypton") is the Active LTS line, supported until 2028-04-30.

# --- Build stage: compile the React app to static files ---
FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Vite inlines any VITE_-prefixed build-time value into the shipped bundle, so
# nothing secret may be passed to this stage. That is why onklave.yaml declares
# DATABASE_URL on `api` only.
RUN npm run build

# --- Runtime stage: the built files and a dependency-free server ---
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/dist /www
COPY --chown=node:node serve.js ./serve.js

# `node` (uid 1000) ships with the image. No node_modules at runtime: serve.js
# uses only the Node standard library.
USER node
EXPOSE 3000
ENV WEB_ROOT=/www

CMD ["node", "serve.js"]
