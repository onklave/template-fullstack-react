// Route tests. No Postgres involved: the app takes a store, and this passes it
// a fake one. That is the whole reason the query layer is a separate module.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';

/** In-memory stand-in for createPgStore(). Same three methods. */
function createFakeStore(seed = []) {
  let nextId = seed.length + 1;
  const items = [...seed];
  return {
    async list() {
      return [...items].reverse();
    },
    async add(text) {
      const item = { id: String(nextId++), text, createdAt: new Date().toISOString() };
      items.push(item);
      return item;
    },
  };
}

describe('api service', () => {
  let base;
  let server;

  before(async () => {
    server = createApp(createFakeStore()).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  const get = (path) => fetch(base + path);
  const post = (path, body) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('serves the health probe at /api/healthz', async () => {
    const res = await get('/api/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  // The platform does not strip the /api prefix, so an unprefixed route must
  // NOT resolve. If this test ever goes green at /healthz, the service is
  // serving on a path the ingress will never send it.
  it('serves nothing outside the /api prefix', async () => {
    for (const path of ['/healthz', '/items', '/']) {
      const res = await get(path);
      assert.equal(res.status, 404, `GET ${path} resolved outside /api`);
      assert.deepEqual(await res.json(), { error: 'Not Found' });
    }
  });

  it('round-trips an item through POST then GET', async () => {
    const created = await post('/api/items', { text: 'first item' });
    assert.equal(created.status, 201);
    const { item } = await created.json();
    assert.equal(item.text, 'first item');
    assert.ok(item.id, 'created item has an id');

    const listed = await get('/api/items');
    assert.equal(listed.status, 200);
    const { items } = await listed.json();
    assert.ok(
      items.some((i) => i.id === item.id && i.text === 'first item'),
      'created item appears in the list',
    );
  });

  it('rejects an empty or missing text', async () => {
    for (const body of [{}, { text: '   ' }, { text: 42 }]) {
      const res = await post('/api/items', body);
      assert.equal(res.status, 400, `body ${JSON.stringify(body)} was accepted`);
      assert.deepEqual(await res.json(), { error: 'text is required' });
    }
  });

  it('rejects an over-long text', async () => {
    const res = await post('/api/items', { text: 'x'.repeat(501) });
    assert.equal(res.status, 400);
  });

  it('returns JSON, not HTML, for an unknown route under /api', async () => {
    const res = await get('/api/nope');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  });

  it('does not advertise the framework', async () => {
    const res = await get('/api/healthz');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  // Same-origin by design: web and api share one host behind one auth gate.
  // A CORS header here would mean someone had started treating the API as a
  // cross-origin service, which the deploy shape does not require.
  it('sets no CORS headers', async () => {
    const res = await get('/api/healthz');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('returns a non-leaking 500 when the store fails', async () => {
    const failing = createApp({
      async list() {
        throw new Error('connection to database failed at db.internal:5432');
      },
      async add() {
        throw new Error('unreachable');
      },
    });
    const s = failing.listen(0);
    await new Promise((resolve) => s.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/items`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.deepEqual(body, { error: 'Internal Server Error' });
      assert.ok(!JSON.stringify(body).includes('db.internal'), 'internals leaked to the client');
    } finally {
      s.close();
    }
  });
});
