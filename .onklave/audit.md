# Template audit

- **Last audited:** 2026-08-04
- **Audited by:** Onklave platform maintenance (automated, Claude Code)
- **Next review due:** 2026-11-04 (quarterly, or sooner on a dependency alert)

## Why this file exists
So we know when this template was last deliberately checked, and what was true at
the time. Apps are generated from this repo — stale or vulnerable dependencies
here propagate to every app created from it.

This entry is the template's initial build-and-verify pass, not a maintenance
re-audit: the repo was created on this date, so everything below is a first
recording rather than a comparison against a previous state.

## Scope of this audit
- Verification of the template as shipped: install, build, both test suites,
  typecheck, and a Docker build of **both** service images.
- End-to-end verification of the multi-service contract: both containers plus a
  throwaway PostgreSQL, fronted by an nginx stand-in for the platform ingress,
  with path-based routing on one host and no prefix stripping.
- Dependency currency and vulnerability status (`npm audit`, `npm outdated`) for
  both workspaces.
- Node base image currency against the official Node.js release schedule.
- Dockerfile review: base image, non-root execution, build/runtime split,
  build-context isolation, `.dockerignore` correctness (verified by listing the
  running containers' filesystems).
- Security review: secrets in the tree, CORS posture, HTTP server timeouts,
  error/fingerprint leakage, static-server path traversal and directory listing,
  and that no secret can reach the browser bundle.
- Not in scope: OS-package CVE scan of the built images (see Findings #4); a
  real-browser render of the built bundle (see Findings #5).

## Verification run
| Check | Command | Result |
|---|---|---|
| API install | `npm install` (server/) | Pass — 81 packages, 0 vulnerabilities |
| Client install | `npm install` (client/) | Pass — 105 packages, 0 vulnerabilities, one EBADENGINE warning (Finding #3) |
| API tests | `npm test` (server/) | Pass — `# tests 12`, `# pass 12`, `# fail 0`, 248ms |
| Client tests | `npm test` (client/) | Pass — 3 files, 19/19 tests, 424ms |
| Client typecheck | `npx tsc --noEmit` | Pass — exit 0 (after fixing two real type errors, see Changes) |
| API lint | `npm run lint` (server/) | Pass — `node --check` clean on all four source files |
| Client build | `npm run build` (client/) | Pass — `dist/index.html` 0.40 kB, CSS 0.94 kB, JS 191.95 kB (60.66 kB gzip) |
| Vulnerability scan | `npm audit` (both) | Pass — 0 vulnerabilities in each workspace |
| Outdated check (api) | `npm outdated` | Pass — nothing outdated (exit 0, empty) |
| Outdated check (client) | `npm outdated` | One row: jsdom (registry `latest` dist-tag is 30.0.1, which is what is installed; see Finding #3) |
| Web image build | `docker build -f client/Dockerfile -t tfr-web:verify client` | Pass — 230MB |
| API image build | `docker build -f server/Dockerfile -t tfr-api:verify server` | Pass — 236MB |
| Throwaway database | `docker run postgres:17-alpine` | Pass — `pg_isready` accepting connections |
| API against real Postgres | `docker run … -e DATABASE_URL=…` | Pass — `api listening on :8080 (routes under /api)`, table created on startup |
| API health | `curl /api/healthz` | Pass — 200 `{"status":"ok"}` |
| **`/api` prefix is real** | `curl /healthz` (unprefixed) | Pass — 404 `{"error":"Not Found"}`; the service serves nothing outside `/api` |
| Row round-trip | `curl -X POST /api/items` then `GET /api/items` | Pass — 201 `{"item":{"id":"1",…}}`, then listed back |
| Survives container replacement | `docker rm -f` the api, re-run, `GET /api/items` | Pass — row still present; no state on the container filesystem |
| Fail-fast without `DATABASE_URL` | `docker run tfr-api:verify` (no env) | Pass — exits immediately with `Error: DATABASE_URL is not set. The api service cannot start without it…`; no in-memory fallback |
| Web health | `curl /health` on the web container | Pass — 200 `{"status":"ok"}` |
| Web security headers | `curl -D-` on `/` | Pass — CSP `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`, `nosniff`, `Referrer-Policy`, `Cache-Control: no-cache` on index.html |
| Web does not serve `/api` | `curl /api/healthz` on the web container | Pass — 404; `/api` belongs to the other service |
| **One host, path routing** | nginx stand-in ingress: `/api`→api:8080 (no rewrite), `/`→web:3000 | Pass — `/` 200 (React shell), `/assets/*.js` 200 `text/javascript`, `/api/healthz` 200, `POST /api/items` 201, `GET /api/items` 200 |
| **Same-origin, no CORS** | `curl -D-` through the ingress on `/api/items` | Pass — no `Access-Control-*` header anywhere; the app has no CORS middleware and needs none |
| No framework fingerprint | `curl -D- /api/healthz` | Pass — no `X-Powered-By` |
| Container user (both) | `docker exec … id` | Pass — `uid=1000(node) gid=1000(node)` on both images |
| Container Node version | `docker exec tfr-api node -v` | Pass — v24.19.0 |
| Image contents (api) | `docker exec tfr-api ls -a /app` | Pass — only `node_modules`, `package.json`, `src`; no tests, no Dockerfile, no `.env*` |
| Image contents (web) | `docker exec tfr-web ls -a /app /www` | Pass — `/app` holds `serve.js` alone (no `node_modules`); `/www` holds `index.html` + `assets/` only |
| No inline script/style in bundle | `grep '<script>\|style=' dist/index.html` | Pass — 0 matches, which is what makes `default-src 'self'` viable without `unsafe-inline` |
| Secret scan | `grep -rInE '(api[_-]?key\|secret\|password\|PRIVATE KEY\|AKIA…\|ghp_…\|xox…\|postgres://…:…@)'` over the tree | Pass — every hit is prose, the `secret: true` schema field, an obvious test fixture (`postgres://u:p@h:5432/db`), or a header-name assertion. No credentials. |
| `.github/` absent | `ls -d .github` | Pass — does not exist, by design |
| Real-browser render | — | **Not run** — see Findings #5 |
| Image OS CVE scan | `docker scout cves …` | **Not run** — see Findings #4 |

All checks marked Pass were executed; the results are the real observed output.
The two "Not run" rows are stated as such rather than assumed.

## Dependency status
Everything was pinned to the current `latest` at creation, so there is no
before/after to report. Direct dependencies as shipped:

**`server/` (api)**

| Package | Range | Resolved | Notes |
|---|---|---|---|
| express | ^5.2.1 | 5.2.1 | Current major. Express 5 forwards rejected promises to the error handler, which is why the async routes need no try/catch. |
| pg | ^8.22.0 | 8.22.0 | Current major. |

**`client/` (web)**

| Package | Range | Resolved | Type |
|---|---|---|---|
| react / react-dom | ^19.2.8 | 19.2.8 | runtime |
| @types/react / @types/react-dom | ^19.2.18 / ^19.2.4 | as ranged | dev |
| vite | ^8.2.0 | 8.2.0 | dev |
| @vitejs/plugin-react | ^6.0.5 | 6.0.5 | dev |
| vitest | ^4.1.10 | 4.1.10 | dev |
| typescript | ^7.0.2 | 7.0.2 | dev |
| jsdom | ^30.0.1 | 30.0.1 | dev — see Finding #3 |
| @testing-library/react / dom | ^16.3.2 / ^10.4.1 | as ranged | dev |

The `web` runtime image contains **no** npm dependencies: `client/serve.js` uses
only the Node standard library, so React and Vite exist at build time only.

Base images: `node:24-alpine` for both build and runtime stages of both services.
Node 24 ("Krypton") is the Active LTS line, supported until 2028-04-30.

## Findings

1. **(informational) The `/api` prefix is a load-bearing convention, not an
   enforced one.** The platform routes by `expose.path` and does not strip the
   prefix, so an API that mounts a route at `/healthz` instead of `/api/healthz`
   builds cleanly, passes a naive local test, and is simply unreachable in the
   cluster. **Action taken:** the API mounts one router at `/api`
   (`server/src/app.js`), and `server/test/app.test.js` asserts that `/healthz`,
   `/items` and `/` all 404 — the mistake now fails a test rather than a deploy.

2. **(informational) A secret handed to the client would be published.** Vite
   inlines `VITE_`-prefixed build-time values into the shipped bundle.
   **Action taken:** `DATABASE_URL` is declared under `api` only in
   `onklave.yaml`; `client/.dockerignore` excludes `.env*` and `*.local` so a
   local file cannot enter the web build context; both facts are commented at
   the point where someone would be tempted to change them.

3. **(low) The client's dev toolchain has a higher Node floor than the template
   declares.** jsdom 30 requires `^22.22.2 || ^24.15.0 || >=26`, so installing on
   Node 22.22.0 emits an EBADENGINE warning (tests still pass — verified). The
   template's `engines.node` is the permissive `>=22`, and the containers run
   Node 24, so builds and production are unaffected. **Not fixed:** tightening
   `engines` to satisfy a dev-only transitive constraint would misrepresent what
   the app itself needs. **Recommended:** develop on Node 24 to match the image.

4. **(low) No OS-package vulnerability scan of the built images.**
   `docker scout` requires a Docker Hub login that is not available in this
   environment, so the Alpine base layers were not scanned. npm-level
   dependencies are clean in both workspaces. **Recommended:** wire an
   authenticated image scan (Docker Scout, Trivy or Grype) into whatever pipeline
   builds template images.

5. **(low) The built bundle was not rendered in a real browser.** The Chrome
   automation available here required an interactive browser selection, so the
   React app was exercised through jsdom (`client/src/App.test.tsx` — render,
   mount fetch of `/api/items`, submit, error path) and the served artefacts were
   exercised over HTTP through the ingress stand-in (`/` returns the shell,
   `/assets/*.js` returns `text/javascript`). What was **not** directly observed
   is a browser executing the bundle end-to-end against the live API.
   **Recommended:** cover this with a Playwright smoke test if the template
   family gains an E2E harness.

6. **(low, not fixed — deliberate) Base images are floating tags, not
   digest-pinned.** `node:24-alpine` picks up patched base images automatically,
   which is good for security but means builds are not byte-reproducible. Left
   as-is for a template; pin by digest only if a generated app needs reproducible
   builds for compliance.

7. **(low, not fixed — deliberate) `npm ci` runs dependency lifecycle scripts at
   build time.** Without `--ignore-scripts`, a compromised transitive package can
   execute code during the image build. Adding the flag is safe for this template
   but would break any generated app with a native build step. Treat as a per-app
   decision; revisit if Onklave gains a build-time supply-chain policy.

8. **(informational, not fixed — deliberate) No SPA fallback in the static
   server.** Unknown paths 404 rather than returning `index.html`. Correct for a
   template with no client-side router — a blanket fallback turns every typo into
   a 200 — but the first thing to change when react-router is added. Documented
   in the README and at the 404 branch in `client/serve.js`.

9. **(informational, not fixed — deliberate) The health probe does not touch the
   database.** `/api/healthz` answers "is this process serving?". A probe that
   failed on a transient database blip would restart healthy pods and turn a
   database wobble into an outage. If a readiness-vs-liveness split is wanted
   later, add a separate database-touching endpoint rather than changing this one.

**Verified clean (no action needed):**
- **No secrets in the tree.** The only connection-string-shaped literal is a
  test fixture with placeholder credentials. No `.env` file is tracked.
- **No CORS anywhere,** and none needed: verified through the one-host ingress
  stand-in that `/api` calls carry no `Access-Control-*` headers. A test asserts
  the API sets none and another asserts the client sends no `Authorization` or
  `X-API-Key` header and never uses an absolute URL.
- **Both containers run non-root** (uid/gid 1000) and write nothing at runtime —
  confirmed by replacing the api container and finding the row intact.
- **Build-context isolation works.** Each image is built from its own directory,
  so the web image physically cannot contain API source or an API dependency;
  confirmed by listing both containers' filesystems.
- **`.dockerignore` files are correct.** No `.git`, tests, Dockerfile, README,
  `.env*`, `*.pem`, `*.key` or host `node_modules` in either image.
- **Path traversal and directory listings are blocked** in the static server
  (`/../`, `/%2e%2e/`, `/assets/` all refused), and write methods return 405.
- **Explicit HTTP timeouts on both services** (`keepAliveTimeout` 10s <
  `headersTimeout` 20s, `requestTimeout` 30s) — no unbounded reads or idles.
- **Errors do not leak internals.** A store failure returns
  `{"error":"Internal Server Error"}` with the detail logged server-side only;
  asserted by a test that fails if a hostname appears in the response body.
- **SQL is parameterised,** and item text is length-bounded (500) with a 16kb
  JSON body limit.

## Changes made in this audit
This is the template's initial commit, so the whole repo is the change. Fixes
made *during* verification, in response to a check failing, were:

- `client/vite.config.ts`: import `defineConfig` from `vitest/config` rather than
  `vite` — the `test` block is not part of Vite's own config type, and `tsc`
  rejected it.
- `client/vite.config.ts`: dropped a `process.env.API_ORIGIN` override for the
  dev proxy target. It required `@types/node` for a configurability nobody asked
  for; the target is now a literal.
- `client/src/App.test.tsx`: gave a `vi.fn` mock its parameter types, so
  `spy.mock.calls[0][0]` is not indexing an empty tuple.

All three were found by `npx tsc --noEmit` and fixed before commit; tests, build
and both Docker builds were re-run afterwards.

## Open items
1. **Add a real-browser E2E smoke test** (Finding #5). The jsdom tests and the
   HTTP-level ingress verification together cover the contract, but nothing here
   has watched Chrome execute the bundle against the live API.
2. **Add an authenticated image CVE scan** to the template pipeline (Finding #4)
   — this pass could only clear npm-level dependencies, not the Alpine base layer.
3. **Decide the migration story for generated apps.** `CREATE TABLE IF NOT
   EXISTS` on startup is right for a template and wrong for anything that ever
   needs to change a column. A human should decide whether this template family
   should point at a specific migration tool.
4. **Decide whether `engines.node` should move to `>=24`** across the template
   family (Finding #3) — the same open question the node-web-service template
   raised. It is currently a permissive floor, so dev and prod can differ by a
   major version.
5. **Confirm the platform's `build.dockerfile` path convention.** This manifest
   uses `context: client` with `dockerfile: client/Dockerfile` — a
   repo-root-relative Dockerfile path alongside a repo-root-relative context.
   That is what was specified, and it is unambiguous, but it differs from
   `docker build -f` semantics where `-f` is commonly written relative to the
   context. Worth pinning down in the platform docs before more multi-service
   templates copy it.
