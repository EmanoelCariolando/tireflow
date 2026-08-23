import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocationStockRestorationPlan,
  type ProductStockSnapshot,
} from '../src/database/restoreLocationStock.js';

function product(
  id: string,
  stock: number,
  stockLocation: string | null
): ProductStockSnapshot {
  return {
    id,
    reference: `REF-${id}`,
    description: `PNEU ${id}`,
    stock,
    stockLocation,
  };
}

test('restores only positive backup stock from the selected location', () => {
  const backup = [
    product('cg-zeroed', 7, 'CG'),
    product('cg-location-cleared', 3, 'cg'),
    product('cg-no-stock', 0, 'CG'),
    product('w3', 8, 'W3'),
  ];
  const current = [
    product('cg-zeroed', 0, 'CG'),
    product('cg-location-cleared', 0, null),
    product('cg-no-stock', 0, null),
    product('w3', 0, 'W3'),
  ];

  const plan = buildLocationStockRestorationPlan(backup, current, 'CG');

  assert.equal(plan.backupProducts, 2);
  assert.equal(plan.backupUnits, 10);
  assert.equal(plan.updates.length, 2);
  assert.deepEqual(
    plan.updates.map((update) => [update.productId, update.stock, update.stockLocation]),
    [
      ['cg-zeroed', 7, 'CG'],
      ['cg-location-cleared', 3, 'CG'],
    ]
  );
  assert.equal(plan.missing.length, 0);
  assert.equal(plan.conflicts.length, 0);
});

test('blocks restoration when stock changed after the backup', () => {
  const backup = [product('changed', 7, 'CG')];
  const current = [product('changed', 2, null)];

  const plan = buildLocationStockRestorationPlan(backup, current, 'CG');

  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.conflicts[0]?.reason ?? '', /estoque atual não está zerado/);
});

test('restores only the location when backup stock is already present', () => {
  const backup = [product('location-only', 4, 'CG')];
  const current = [product('location-only', 4, null)];

  const plan = buildLocationStockRestorationPlan(backup, current, 'CG');

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0]?.previousStock, 4);
  assert.equal(plan.updates[0]?.stock, 4);
  assert.equal(plan.updates[0]?.stockLocation, 'CG');
});
