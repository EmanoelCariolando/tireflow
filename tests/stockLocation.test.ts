import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineStockLocations,
  formatStockLocationLine,
  normalizeSingleStockLocation,
  normalizeStockLocation,
  parseStockLocationChoice,
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

test('accepts numbered and named stock location choices', () => {
  assert.equal(parseStockLocationChoice('1'), 'W3');
  assert.equal(parseStockLocationChoice('2'), 'PMAIS');
  assert.equal(parseStockLocationChoice('3'), 'CG');
  assert.equal(parseStockLocationChoice(' w3 '), 'W3');
  assert.equal(parseStockLocationChoice('pmais'), 'PMAIS');
  assert.equal(parseStockLocationChoice('cg'), 'CG');
  assert.equal(parseStockLocationChoice('4'), null);
  assert.equal(parseStockLocationChoice('corredor 1'), null);
});
