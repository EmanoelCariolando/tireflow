import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, ProductCategory } from '@prisma/client';
import type { Message } from 'whatsapp-web.js';
import {
  getMotorcycleTireRim,
  handleMotorcycleTireCommand,
  parseMotorcycleTireCommand,
} from '../src/commands/motorcycleTireCommand.js';
import { productRepository } from '../src/repositories/productRepository.js';
import { clearLastQuery, getLastQuery } from '../src/utils/lastQueryStore.js';
import {
  clearProductActionSession,
  getProductActionSession,
} from '../src/utils/productActionSessionStore.js';

test('recognizes motorcycle rim searches and their zero-stock form', () => {
  assert.deepEqual(parseMotorcycleTireCommand('mt 21'), { rim: 21, zeroStock: false });
  assert.deepEqual(parseMotorcycleTireCommand(' MT   18 '), { rim: 18, zeroStock: false });
  assert.deepEqual(parseMotorcycleTireCommand('0 mt 21'), { rim: 21, zeroStock: true });
  assert.equal(parseMotorcycleTireCommand('mt'), null);
  assert.equal(parseMotorcycleTireCommand('pneu mt 21'), null);
  assert.equal(parseMotorcycleTireCommand('0 90 90 21'), null);
});

test('extracts the rim from metric and bias motorcycle references', () => {
  assert.equal(getMotorcycleTireRim('90/90-21'), 21);
  assert.equal(getMotorcycleTireRim('80/100 R14'), 14);
  assert.equal(getMotorcycleTireRim('2.75-18'), 18);
  assert.equal(getMotorcycleTireRim('invalid'), null);
});

test('mt lists only positive motorcycle tires from the requested rim', async (t) => {
  const userId = 'motorcycle-positive-user';
  const chatId = 'motorcycle-positive-group@g.us';
  const replies: string[] = [];
  const query = t.mock.method(productRepository, 'findActiveMotorcycleTires', async () => [
    {
      id: 'rim-21', reference: '90/90-21', description: 'MOTO ARO 21',
      category: ProductCategory.MOTORCYCLE_TIRE, batteryBrand: null, imagePath: null,
      stockLocation: null, stock: 2, minStock: 0,
      cashPrice: new Prisma.Decimal(219), creditPrice: new Prisma.Decimal(231.7),
      tenInstallmentPrice: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 'rim-18', reference: '90/90-18', description: 'MOTO ARO 18',
      category: ProductCategory.MOTORCYCLE_TIRE, batteryBrand: null, imagePath: null,
      stockLocation: null, stock: 4, minStock: 0,
      cashPrice: new Prisma.Decimal(179), creditPrice: new Prisma.Decimal(189.38),
      tenInstallmentPrice: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    },
  ]);
  const message = {
    author: userId,
    from: chatId,
    reply: async (text: string) => { replies.push(text); },
  } as unknown as Message;

  try {
    await handleMotorcycleTireCommand(message, 'mt 21');
    assert.equal(query.mock.calls[0]?.arguments[0], false);
    assert.match(replies[0] ?? '', /PNEUS DE MOTO — ARO 21/);
    assert.match(replies[0] ?? '', /MOTO ARO 21/);
    assert.doesNotMatch(replies[0] ?? '', /MOTO ARO 18/);
    assert.deepEqual(getLastQuery(userId, chatId)?.products.map((product) => product.id), ['rim-21']);
    assert.equal(getProductActionSession(userId, chatId)?.mode, 'standard');
  } finally {
    clearLastQuery(userId, chatId);
    clearProductActionSession(userId, chatId);
  }
});

test('0 mt lists only zero-stock motorcycle tires and opens zero-stock actions', async (t) => {
  const userId = 'motorcycle-zero-user';
  const chatId = 'motorcycle-zero-group@g.us';
  const replies: string[] = [];
  const query = t.mock.method(productRepository, 'findActiveMotorcycleTires', async () => [{
    id: 'zero-21', reference: '90/100-21', description: 'MOTO ZERADA',
    category: ProductCategory.MOTORCYCLE_TIRE, batteryBrand: null, imagePath: null,
    stockLocation: null, stock: 0, minStock: 0,
    cashPrice: new Prisma.Decimal(389), creditPrice: new Prisma.Decimal(411.56),
    tenInstallmentPrice: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
  }]);
  const message = {
    author: userId,
    from: chatId,
    reply: async (text: string) => { replies.push(text); },
  } as unknown as Message;

  try {
    await handleMotorcycleTireCommand(message, '0 mt 21');
    assert.equal(query.mock.calls[0]?.arguments[0], true);
    assert.match(replies[0] ?? '', /ARO 21 — ESTOQUE ZERO/);
    assert.match(replies[0] ?? '', /MOTO ZERADA/);
    assert.equal(getProductActionSession(userId, chatId)?.mode, 'zero_stock');
  } finally {
    clearLastQuery(userId, chatId);
    clearProductActionSession(userId, chatId);
  }
});
