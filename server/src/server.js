// Process entry point: wire the store to the app, create the schema, listen.
import { createApp } from './app.js';
import { createPool } from './db.js';
import { createPgStore } from './items-store.js';
import { initOnklave } from './onklave.js';

// Platform wiring first: per-environment secrets (DATABASE_URL included) land
// in process.env and error tracking starts. A no-op off-platform (local dev).
await initOnklave(process.env.APP_NAME || 'template-fullstack-react-api');

const port = Number(process.env.PORT ?? 8080);

// createPool() throws if DATABASE_URL is absent. Let it: an API with no
// database should exit loudly at startup, not serve requests that quietly
// lose data.
const pool = createPool();
const store = createPgStore(pool);

await store.init();

const server = createApp(store).listen(port, () => {
  console.log(`api listening on :${port} (routes under /api)`);
});

// Explicit timeouts — without them a stalled client can hold a connection open
// indefinitely (Slowloris). keepAliveTimeout must stay below headersTimeout, or
// Node can race a keep-alive close against an in-flight request.
server.keepAliveTimeout = 10_000;
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

// Drain on rollout instead of dropping in-flight requests when the orchestrator
// replaces this container.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
