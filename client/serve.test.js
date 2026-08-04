// @vitest-environment node
//
// Exercises the static server against a real temporary directory — the same
// shape Vite emits into dist/.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWebServer } from './serve.js';

let base;
let server;

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'web-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(path.join(root, 'assets', 'index-abc123.js'), 'export const a = 1;');
  await writeFile(path.join(root, 'assets', 'index-abc123.css'), 'body{margin:0}');

  server = createWebServer(root);
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

const get = (p, init) => fetch(base + p, init);

describe('static server', () => {
  it('answers the platform health probe at /health', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('serves index.html at /', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    await expect(res.text()).resolves.toContain('id="root"');
  });

  it('serves hashed assets with the right MIME type', async () => {
    const js = await get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/text\/javascript/);

    const css = await get('/assets/index-abc123.css');
    expect(css.headers.get('content-type')).toMatch(/text\/css/);
  });

  it('caches fingerprinted assets forever and index.html never', async () => {
    expect((await get('/assets/index-abc123.js')).headers.get('cache-control')).toContain(
      'immutable',
    );
    expect((await get('/')).headers.get('cache-control')).toBe('no-cache');
  });

  it('sets the baseline security headers', async () => {
    const res = await get('/');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('404s unknown paths instead of falling back to index.html', async () => {
    expect((await get('/does-not-exist')).status).toBe(404);
  });

  // /api belongs to the other service. If this server ever answered it, a
  // routing mistake would look like a working app in local testing and fail
  // in the cluster.
  it('does not serve anything under /api', async () => {
    expect((await get('/api/healthz')).status).toBe(404);
  });

  it('suppresses directory listings', async () => {
    expect((await get('/assets/')).status).toBe(404);
  });

  it('refuses to escape the served root', async () => {
    for (const p of ['/../serve.js', '/assets/../../package.json', '/%2e%2e/serve.js']) {
      const res = await get(p);
      expect([403, 404]).toContain(res.status);
    }
  });

  it('rejects write methods', async () => {
    const res = await get('/', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});
