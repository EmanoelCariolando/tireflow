import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductCategory } from '@prisma/client';
import type { Message } from 'whatsapp-web.js';
import { prisma } from '../src/database/prisma.js';
import { parseRetreadedTireCommand, handleRetreadedTireCommand } from '../src/commands/retreadedTireCommand.js';
import { getLastQuery } from '../src/utils/lastQueryStore.js';
import { getProductActionSession } from '../src/utils/productActionSessionStore.js';
import fs from 'node:fs';

test('recognizes separate retreaded tire commands without consuming other searches', () => {
  assert.equal(parseRetreadedTireCommand('coberto'), ProductCategory.RETREADED_TIRE);
  assert.equal(parseRetreadedTireCommand(' COBERTO  MT '), ProductCategory.MOTORCYCLE_RETREADED_TIRE);
  for (const body of ['mt', 'camara', 'camara mt', 'bateria 60', '175 70 14', 'coberto extra']) assert.equal(parseRetreadedTireCommand(body), null);
});

test('queries only the selected category and stock mode and preserves indexed product actions', async () => {
  const originalFind = prisma.product.findMany;
  try {
  for (const [body, category] of [['coberto', ProductCategory.RETREADED_TIRE], ['coberto mt', ProductCategory.MOTORCYCLE_RETREADED_TIRE]] as const) {
    for (const zeroStock of [false, true]) {
      const replies: string[] = [];
      const message = { from: `retread-${body}-${zeroStock}`, reply: async (text: string) => { replies.push(text); } } as unknown as Message;
      prisma.product.findMany = (async (args: unknown) => {
        assert.deepEqual((args as {where: unknown}).where, { category, isActive: true, stock: zeroStock ? { lte: 0 } : { gt: 0 } });
        return [{ id: 'retread-product', reference: 'TEST', description: 'PNEU COBERTO TESTE', category, stock: zeroStock ? 0 : 5, cashPrice: 95, creditPrice: 99.75, imagePath: null }];
      }) as typeof prisma.product.findMany;
      await handleRetreadedTireCommand(message, body, zeroStock);
      assert.match(replies[0]!, body.endsWith('mt') ? /PNEUS COBERTOS — MOTOS/ : /PNEUS COBERTOS — CARROS E MÁQUINAS/);
      assert.equal(replies[0]!.includes('ESTOQUE ZERO'), zeroStock);
      assert.match(replies[1]!, /Digite o número do pneu/);
      assert.equal(getLastQuery(message.from, message.from)?.products[0]?.id, 'retread-product');
      assert.equal(getProductActionSession(message.from, message.from)?.step, 'awaiting_product');
    }
  }
  } finally {
    prisma.product.findMany = originalFind;
  }
});

test('the reviewed PDF catalog contains only priced products and the updated final stock', () => {
  const rows = fs.readFileSync('data/seed/congo_retreaded_tires_2026-10-15.csv', 'utf8')
    .trim().split(/\r?\n/).slice(1).map((line) => line.split(','));

  assert.equal(rows.length, 17);
  assert.equal(rows.filter((row) => row[6] === ProductCategory.MOTORCYCLE_RETREADED_TIRE).length, 7);
  assert.equal(rows.filter((row) => row[6] === ProductCategory.RETREADED_TIRE).length, 10);
  assert.equal(rows.reduce((total, row) => total + Number(row[5]), 0), 28);
  assert.equal(rows.find((row) => row[0] === 'COB-16-750-16-TRAZ')?.[5], '4');
  assert.ok(rows.every((row) => /^\d+\.\d{2}$/.test(row[2]!) && /^\d+\.\d{2}$/.test(row[3]!) && /^\d+\.\d{2}$/.test(row[4]!)));
});
