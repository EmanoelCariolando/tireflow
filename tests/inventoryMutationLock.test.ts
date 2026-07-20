import assert from 'node:assert/strict';
import test from 'node:test';
import { withInventoryMutationLock } from '../src/services/inventoryMutationLock.js';

test('serializes concurrent SQLite mutations and releases the queue after failures', async () => {
  const events: string[] = [];
  const first = withInventoryMutationLock(async () => {
    events.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push('first-end');
  });
  const second = withInventoryMutationLock(async () => {
    events.push('second-start');
    events.push('second-end');
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);

  await assert.rejects(withInventoryMutationLock(async () => { throw new Error('expected'); }));
  assert.equal(await withInventoryMutationLock(async () => 'released'), 'released');
});
