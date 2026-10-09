import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { ProductCategory } from '@prisma/client';
import { parseInnerTubeCommand, formatInnerTubeList } from '../src/commands/innerTubeCommand.js';
import { formatQuantityQuestion } from '../src/utils/operationPrompts.js';
import { formatProductChoiceQuestion } from '../src/commands/pneuCommand.js';
import { getProductNoun } from '../src/utils/productCategory.js';

test('separates motorcycle tubes from other tubes with accented and unaccented commands', () => {
  assert.equal(parseInnerTubeCommand('camara'), ProductCategory.INNER_TUBE);
  assert.equal(parseInnerTubeCommand(' CÂMARA  MT '), ProductCategory.MOTORCYCLE_INNER_TUBE);
  for (const value of ['mt', '1', 'camarao', 'bateria 60']) assert.equal(parseInnerTubeCommand(value), null);
});

test('tube selection, quantity and listing use the correct category', () => {
  for (const category of [ProductCategory.INNER_TUBE, ProductCategory.MOTORCYCLE_INNER_TUBE]) {
    assert.match(formatProductChoiceQuestion(category), /CÂMARA DE AR/);
    assert.match(formatQuantityQuestion(category), /Quantas câmaras de ar/);
    assert.equal(getProductNoun(category, true), 'câmaras de ar');
    assert.match(formatInnerTubeList([], category, true), /ESTOQUE ZERO/);
  }
  assert.match(formatInnerTubeList([], ProductCategory.MOTORCYCLE_INNER_TUBE), /MOTOS/);
  assert.match(formatInnerTubeList([], ProductCategory.INNER_TUBE), /CARROS E AGRÍCOLAS/);
});

test('PDF import contains only tubes, with expected category stock totals', () => {
  const rows = fs.readFileSync('data/seed/congo_inner_tubes_2026-10-08.csv', 'utf8').trim().split(/\r?\n/).slice(1).map(line => line.split(','));
  assert.equal(rows.length, 82);
  assert.equal(new Set(rows.map(row => row[0])).size, 82);
  assert.ok(rows.every(row => /^CAM (MOTO|CARRO|AGRICOLA) /.test(row[1]!)));
  for (const [category, count, stock] of [[ProductCategory.MOTORCYCLE_INNER_TUBE, 15, 253], [ProductCategory.INNER_TUBE, 67, 103]] as const) {
    const group = rows.filter(row => row[5] === category);
    assert.equal(group.length, count);
    assert.equal(group.reduce((sum, row) => sum + Number(row[4]), 0), stock);
  }
});
