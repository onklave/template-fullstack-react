import { afterEach, describe, expect, it, vi } from 'vitest';

import { createItem, fetchItems } from './api';

function stubFetch(impl: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('reads items from the same-origin /api path', async () => {
    const spy = stubFetch(() => json({ items: [{ id: '1', text: 'a', createdAt: 'now' }] }));

    await expect(fetchItems()).resolves.toEqual([{ id: '1', text: 'a', createdAt: 'now' }]);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/items');
    expect(init).toBeUndefined();
  });

  // The contract this template exists to prove: relative URL, no credentials
  // mode, no API key header, nothing cross-origin.
  it('never uses an absolute URL or an auth header', async () => {
    const spy = stubFetch(() => json({ item: { id: '1', text: 'a', createdAt: 'now' } }));

    await createItem('a');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-api-key')).toBeNull();
    expect([...headers.keys()]).toEqual(['content-type']);
  });

  it('posts the text as JSON', async () => {
    const spy = stubFetch(() => json({ item: { id: '2', text: 'hello', createdAt: 'now' } }, 201));

    await expect(createItem('hello')).resolves.toEqual({
      id: '2',
      text: 'hello',
      createdAt: 'now',
    });

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello' });
  });

  it("surfaces the API's error message", async () => {
    stubFetch(() => json({ error: 'text is required' }, 400));
    await expect(createItem('')).rejects.toThrow('text is required');
  });

  it('falls back to a generic message when the response is not JSON', async () => {
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    await expect(fetchItems()).rejects.toThrow('Request failed (502)');
  });
});
