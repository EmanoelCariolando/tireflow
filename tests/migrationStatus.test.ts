import assert from 'node:assert/strict';
import test from 'node:test';
import { findPendingMigrations } from '../src/database/migrationStatus.js';

test('identifies only unapplied migrations in deterministic order', () => {
  assert.deepEqual(
    findPendingMigrations(
      ['20260821000000_add_entry_invoice_number', '20260704000000_init'],
      ['20260704000000_init']
    ),
    ['20260821000000_add_entry_invoice_number']
  );
});

test('does not report applied migrations or duplicate directory entries', () => {
  assert.deepEqual(
    findPendingMigrations(
      ['20260704000000_init', '20260704000000_init'],
      ['20260704000000_init']
    ),
    []
  );
});
