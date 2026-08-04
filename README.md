# Onklave template: fullstack React

A React + Vite + TypeScript client, an Express + PostgreSQL API, deployed as
**two services behind one host**.

This is the reference for a multi-service Onklave app. The app itself is
deliberately tiny — a list you can add to — because the point is the shape.

```
                    https://<your-app-host>
                              │
                    ┌─────────┴─────────┐
             path /                 path /api
                    │                   │
              ┌─────▼─────┐       ┌─────▼─────┐
              │    web    │       │    api    │
              │  :3000    │       │   :8080   │
              │  React    │       │  Express  │
              └───────────┘       └─────┬─────┘
                                        │ DATABASE_URL
                                  ┌─────▼─────┐
                                  │ PostgreSQL│
                                  └───────────┘
```

## The two services

| | `web` | `api` |
|---|---|---|
| Source | `client/` | `server/` |
| Build context | `client` | `server` |
| Container port | 3000 | 8080 |
| Health path | `/health` | `/api/healthz` |
| Public path | `/` | `/api` |
| Env | none | `DATABASE_URL` |

They are built and deployed **separately** — two images, two Deployments — and
meet only at the ingress. `client/Dockerfile` cannot see `server/` and vice
versa, because each build context is scoped to its own directory.

## Routing is path-based on one host

Everything is served from a single hostname. The ingress sends `/api/...` to the
`api` service and everything else to `web`. Three consequences that shape the
code:

**1. The client calls the API same-origin, with plain `fetch` and a relative
URL.** See `client/src/api.ts` — `fetch('/api/items')`. No API key, no CORS
configuration, no second domain, no `VITE_API_URL`. One host means one origin,
and the browser session that loaded the page is the session that authenticates
the API call. If you find yourself adding CORS middleware, the routing is
wrong — check `expose.path` in `onklave.yaml` first.

**2. The route prefix is not stripped.** What the ingress matches is exactly
what arrives at the container, so the `api` service mounts *every* route under
`/api` itself, health probe included (`/api/healthz`). `server/src/app.js` does
this with a single `app.use('/api', router)`, and `server/test/app.test.js`
asserts that nothing resolves outside the prefix — if that test ever goes green
at `/healthz`, the service is listening on a path the ingress will never send.

**3. Exactly one service may take `/`.** Here that is `web`.

## The database

`api` reads its connection string from **`DATABASE_URL`**, declared in
`onklave.yaml` as `required: true, secret: true`. The platform injects it
per-environment; it is never committed, never hard-coded, never logged.

- **`web` never gets it.** Vite inlines build-time values into the shipped
  bundle, so a secret handed to the client is a published secret. The env block
  in `onklave.yaml` sits under `api` only, deliberately.
- **The schema is created on startup** (`CREATE TABLE IF NOT EXISTS`, in
  `server/src/items-store.js`). Idempotent, so concurrent replicas are fine.
  Anything beyond this shape belongs in a real migration tool.
- **Nothing is written to the local filesystem.** The container is replaced on
  every deploy; the database is the only thing that survives.
- **Missing `DATABASE_URL` is a fast, loud crash**, not a fallback to in-memory
  storage. A silent fallback looks healthy, accepts writes and loses all of
  them.

## Local development

You need a Postgres to point at. Anything works; a throwaway container is
easiest:

```bash
docker run -d --name devpg -p 5432:5432 \
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=appdb postgres:17-alpine
```

Then run the two services in two terminals:

```bash
# API on :8080
cd server && npm install
DATABASE_URL='postgres://postgres:devpass@127.0.0.1:5432/appdb' \
DATABASE_SSL=disable npm run dev

# Client on :5173, proxying /api -> :8080
cd client && npm install && npm run dev
```

The Vite dev proxy (`client/vite.config.ts`) forwards `/api` to the API
**without rewriting the path**, so development sees the same URLs production
does. `DATABASE_SSL=disable` is for a local loopback connection only; managed
Postgres needs TLS, which is the default.

## Tests

```bash
cd server && npm test      # node --test — routes and the /api prefix, no Postgres needed
cd client && npm test      # vitest — React render, data fetch, and the static server
cd client && npm run typecheck
```

The API tests pass a fake store into `createApp()`, which is why they need no
database. That is also the seam to use if you swap Postgres for something else:
implement `list` / `add` / `init` and the routes do not change.

## Adding a third service

1. Create its directory, e.g. `worker/`, with its own `Dockerfile` and
   `.dockerignore`.
2. Add an entry to `onklave.yaml`:

   ```yaml
     - name: worker
       build:
         context: worker
         dockerfile: worker/Dockerfile
       runtime:
         port: 9000
         healthPath: /worker/healthz
       expose:
         enabled: true
         path: /worker
       env:
         - name: DATABASE_URL
           required: true
           secret: true
   ```
3. Mount its routes under its own `expose.path`, health path included — the
   prefix is not stripped for it either.
4. Give it a unique path. `/` is taken by `web`.

An internal service that nothing outside the cluster should reach sets
`expose.enabled: false` and is called by its service name rather than through
the ingress.

## Deployment

`onklave.yaml` is the whole contract. Onklave clones the repo, builds each
service's image in-cluster from its own context, runs the tests, and renders the
Deployment, Service and Ingress from the manifest.

**GitHub Actions is not used.** There is no `.github/` directory here on
purpose: nothing in it would be read, a workflow cannot declare a service, and
the platform's credential cannot push one.

## Container notes

Both images are multi-stage, run as the non-root `node` user (uid 1000) on Node
24 (Active LTS), write nothing at runtime, and set explicit HTTP timeouts
(`keepAliveTimeout` 10s, `headersTimeout` 20s, `requestTimeout` 30s) so a
stalled client cannot hold a connection open indefinitely.

The `web` image carries no `node_modules` at all: `client/serve.js` is a
dependency-free static server using only the Node standard library. It sets
`Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options:
nosniff` and `Referrer-Policy`, caches fingerprinted `/assets/*` immutably and
`index.html` not at all, and serves no directory listings.

It has **no SPA fallback** — an unknown path 404s rather than returning
`index.html`. This template has no client-side router; if you add one (e.g.
react-router), serve `index.html` from the 404 branch in `client/serve.js`.
`/api` is unaffected either way, since those requests never reach this
container.
