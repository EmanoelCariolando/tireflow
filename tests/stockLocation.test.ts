import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineStockLocations,
  formatStockLocationLine,
  normalizeSingleStockLocation,
  normalizeStockLocation,
} from '../src/utils/stockLocation.js';

test('normalizes one or two stock locations without changing old values', () => {
  assert.equal(normalizeStockLocation(' cg '), 'CG');
  assert.equal(normalizeStockLocation('w3/pmais'), 'W3 / PMAIS');
  assert.equal(normalizeStockLocation('W3 / PMAIS'), 'W3 / PMAIS');
  assert.equal(formatStockLocationLine('w3/pmais', true), '📍 Local: *W3 / PMAIS*');
});

test('rejects duplicate, invalid, or more than two stock locations', () => {
  assert.equal(normalizeSingleStockLocation('W3 / PMAIS'), null);
  assert.equal(normalizeStockLocation('W3 / W3'), null);
  assert.equal(normalizeStockLocation('CG / W3 / PMAIS'), null);
  assert.equal(combineStockLocations('W3', 'W3'), null);
});
