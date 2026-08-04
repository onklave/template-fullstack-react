// Database connection.
//
// The connection string comes from DATABASE_URL and nowhere else. It is
// injected per-environment by the platform (declared in onklave.yaml with
// `secret: true`), so it is never hard-coded, never committed, and never
// logged — not even in a redacted form, because a partial connection string
// still leaks host and username.
import { Pool } from 'pg';

/**
 * Reads DATABASE_URL, or throws with an actionable message.
 *
 * Deliberately fails fast rather than falling back to in-memory storage: a
 * silent fallback looks healthy, accepts writes, and loses every one of them
 * when the container is replaced. A crash loop with a clear reason is the
 * honest failure.
 */
export function requireDatabaseUrl(env = process.env) {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The api service cannot start without it. ' +
        'Onklave injects it per-environment from the `env` block in onklave.yaml; ' +
        'for local development, export it yourself (see README).',
    );
  }
  return url;
}

/**
 * Builds the connection pool. Small on purpose: this service is horizontally
 * scaled, so every replica holds its own pool and Postgres sees the sum.
 */
export function createPool(env = process.env) {
  return new Pool({
    connectionString: requireDatabaseUrl(env),
    max: Number(env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Managed Postgres normally requires TLS but presents a certificate signed
    // by a private CA. Set DATABASE_SSL=disable only when talking to a local
    // container over the loopback interface.
    ssl: env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  });
}
