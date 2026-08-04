// The API's HTTP surface.
//
// EVERY route lives under /api, including the health probe. The platform routes
// this service by `expose.path: /api` and does NOT strip that prefix before the
// request reaches the container, so what the ingress matches is exactly what
// Express sees. Mounting a router at '/api' — rather than sprinkling the prefix
// through each path — makes that a single, checkable fact.
//
// There is no CORS middleware here, and adding some would be a sign the routing
// is wrong: `web` and `api` are served from the same host, so the browser's
// calls to /api/... are same-origin and carry the session that loaded the page.
import express from 'express';

import { MAX_ITEM_LENGTH } from './items-store.js';

/**
 * @param {{ list: () => Promise<object[]>, add: (text: string) => Promise<object> }} store
 */
export function createApp(store) {
  const app = express();

  // Don't advertise the framework and version to every caller.
  app.disable('x-powered-by');

  // A bounded body: this API only ever accepts a short string.
  app.use(express.json({ limit: '16kb' }));

  const api = express.Router();

  // Liveness/readiness probe. Deliberately does NOT touch the database: this
  // answers "is this process serving?", and a probe that fails on a transient
  // database blip would restart healthy pods and turn a database wobble into
  // an outage.
  api.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  api.get('/items', async (_req, res) => {
    res.json({ items: await store.list() });
  });

  api.post('/items', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (text.length > MAX_ITEM_LENGTH) {
      res.status(400).json({ error: `text must be ${MAX_ITEM_LENGTH} characters or fewer` });
      return;
    }
    res.status(201).json({ item: await store.add(text) });
  });

  app.use('/api', api);

  // Unknown routes answer JSON, not Express's default HTML page (which echoes
  // the request path back at the caller).
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Express 5 forwards rejected promises from handlers here. Log server-side,
  // return nothing that describes the internals.
  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  app.use((err, _req, res, _next) => {
    console.error('Unhandled error', err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
