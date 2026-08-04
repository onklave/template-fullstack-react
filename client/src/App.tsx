import { useEffect, useState, type FormEvent } from 'react';

import { createItem, fetchItems, type Item } from './api';

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchItems()
      .then((loaded) => {
        if (cancelled) return;
        setItems(loaded);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const created = await createItem(trimmed);
      setItems((current) => [created, ...current]);
      setText('');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <h1>Items</h1>
      <p className="hint">
        Stored in PostgreSQL by the <code>api</code> service, reached same-origin at{' '}
        <code>/api/items</code>.
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="text">New item</label>
        <input
          id="text"
          name="text"
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          placeholder="Something worth persisting"
        />
        <button type="submit">Add</button>
      </form>

      {error && <p role="alert">{error}</p>}

      {status === 'loading' && <p>Loading…</p>}
      {status === 'ready' && items.length === 0 && <p>No items yet.</p>}

      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </main>
  );
}
