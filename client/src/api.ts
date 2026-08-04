// The client's view of the API.
//
// Every URL here is RELATIVE — '/api/items', never 'https://api.example.com/...'.
// That is the point of the deploy shape: the page and the API are served from
// one host, so the request is same-origin and the browser sends the session
// that loaded the page. Consequences worth knowing before you "fix" anything:
//
//   * No API key. A key shipped in a bundle is a public key.
//   * No CORS. Same-origin requests are not preflighted and need no headers.
//   * No base-URL environment variable. Vite inlines build-time values into
//     the bundle, so a per-environment origin would bake one environment's
//     hostname into an artifact meant to be promoted between environments.
//
// If you ever need an absolute URL here, the routing is wrong — check
// `expose.path` in onklave.yaml first.

export type Item = {
  id: string;
  text: string;
  createdAt: string;
};

const API = '/api';

export async function fetchItems(): Promise<Item[]> {
  const res = await fetch(`${API}/items`);
  const body = await readJson(res);
  return body.items as Item[];
}

export async function createItem(text: string): Promise<Item> {
  const res = await fetch(`${API}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await readJson(res);
  return body.item as Item;
}

/**
 * Surfaces the API's own `{ "error": ... }` message when it sends one, and a
 * generic message when it does not — an HTML error page from an ingress, say,
 * should not end up rendered as a string in the UI.
 */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}
