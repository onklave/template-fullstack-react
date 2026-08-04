import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<App />', () => {
  it('renders the items the API returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          items: [
            { id: '2', text: 'second', createdAt: 'now' },
            { id: '1', text: 'first', createdAt: 'now' },
          ],
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('second')).toBeDefined();
    expect(screen.getByText('first')).toBeDefined();
  });

  it('fetches from /api/items on mount', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json({ items: [] }),
    );
    vi.stubGlobal('fetch', spy);

    render(<App />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0][0])).toBe('/api/items');
  });

  it('posts a new item and shows it without a reload', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ item: { id: '9', text: 'a new thing', createdAt: 'now' } }, 201)
        : json({ items: [] }),
    );
    vi.stubGlobal('fetch', spy);

    render(<App />);
    expect(await screen.findByText('No items yet.')).toBeDefined();

    fireEvent.change(screen.getByLabelText('New item'), { target: { value: 'a new thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('a new thing')).toBeDefined();

    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeDefined();
    expect(String(post?.[0])).toBe('/api/items');
  });

  it('shows the error when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Internal Server Error' }, 500)),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Internal Server Error',
    );
  });
});
