// The startup contract: no DATABASE_URL, no service. Asserted here so a future
// "helpful" in-memory fallback cannot be added without a red test.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requireDatabaseUrl } from '../src/db.js';

describe('requireDatabaseUrl', () => {
  it('returns the connection string when it is set', () => {
    assert.equal(
      requireDatabaseUrl({ DATABASE_URL: 'postgres://u:p@h:5432/db' }),
      'postgres://u:p@h:5432/db',
    );
  });

  it('throws a message that names the variable when it is absent', () => {
    assert.throws(() => requireDatabaseUrl({}), /DATABASE_URL is not set/);
  });

  it('treats an empty value as absent', () => {
    assert.throws(() => requireDatabaseUrl({ DATABASE_URL: '' }), /DATABASE_URL is not set/);
  });
});
