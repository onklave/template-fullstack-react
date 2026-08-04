// The query layer, behind a three-method interface: init / list / add.
//
// Keeping SQL here (and nowhere else) is what lets the route tests run with a
// fake store and no live Postgres — see test/app.test.js. Swap the storage
// engine and the routes do not change.

export const MAX_ITEM_LENGTH = 500;

/**
 * Postgres-backed store.
 *
 * @param {import('pg').Pool} pool
 */
export function createPgStore(pool) {
  return {
    /**
     * Creates the table if it is absent.
     *
     * Called on every start because the container is replaced on every deploy
     * and carries no state of its own; the database is the only thing that
     * survives. IF NOT EXISTS keeps it idempotent when several replicas start
     * at once. Anything beyond this shape — indexes, columns, backfills —
     * belongs in a real migration tool, not here.
     */
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS items (
          id         BIGSERIAL PRIMARY KEY,
          text       TEXT        NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },

    async list() {
      const { rows } = await pool.query(
        'SELECT id, text, created_at FROM items ORDER BY id DESC LIMIT 100',
      );
      return rows.map(toItem);
    },

    async add(text) {
      // Parameterised — never string-concatenated into the SQL.
      const { rows } = await pool.query(
        'INSERT INTO items (text) VALUES ($1) RETURNING id, text, created_at',
        [text],
      );
      return toItem(rows[0]);
    },
  };
}

// id is BIGSERIAL, which pg returns as a string to avoid silently truncating
// values past Number.MAX_SAFE_INTEGER. Keep it a string all the way to the
// client rather than parsing it into a lossy number.
function toItem(row) {
  return { id: String(row.id), text: row.text, createdAt: row.created_at };
}
