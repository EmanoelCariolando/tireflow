import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSimilarProductSearchHelp } from '../src/commands/productSearchHelp.js';

test('guides searches that resemble battery, inner-tube and retreaded-tire commands', () => {
  assert.match(formatSimilarProductSearchHelp('baterias 50') ?? '', /bateria 50/);
  assert.match(formatSimilarProductSearchHelp('bateria 50ah') ?? '', /0 bateria 50/);
  assert.match(formatSimilarProductSearchHelp('camera moto') ?? '', /camara mt/);
  assert.match(formatSimilarProductSearchHelp('camaras') ?? '', /0 camara mt/);
  assert.match(formatSimilarProductSearchHelp('cobertos') ?? '', /coberto mt/);
  assert.match(formatSimilarProductSearchHelp('pneu coberto') ?? '', /Carros e máquinas/);
  assert.match(formatSimilarProductSearchHelp('0 coberto moto') ?? '', /0 coberto mt/);
});

test('does not mistake unrelated messages for product searches', () => {
  for (const body of ['bom dia', 'venda', 'mt 21', '175 70 14', 'menu', 'confirmar']) {
    assert.equal(formatSimilarProductSearchHelp(body), null);
  }
});
