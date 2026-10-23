import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';

test('invalidates replaced query selections while preserving independent conversations and sales', async t => {
  assert.equal(process.env.NODE_ENV, 'test', 'Run through npm test for isolation.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-query-context-'));
  const database = path.join(root, 'query.db');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { clearAllOperationSessions } = await import('../src/utils/operationSessionCoordinator.js');
  const { getLastQuery, saveLastQuery, clearLastQuery, LAST_QUERY_TTL_MS } = await import('../src/utils/lastQueryStore.js');
  const { getProductActionSession, saveProductActionSession } = await import('../src/utils/productActionSessionStore.js');
  const { getSaleSession, saveSaleSession } = await import('../src/utils/saleSessionStore.js');
  const { getEntrySession, saveEntrySession } = await import('../src/utils/entrySessionStore.js');
  const chatId = env.whatsappOfficialGroupId;
  const userId = 'query-user';
  let nextId = 0;
  const send = async (body: string, author = userId, from = chatId, reply?: (text: string) => Promise<void>) => {
    const replies: string[] = [];
    await handleIncomingMessage({
      author, from, body, type: 'chat', hasMedia: false,
      id: { _serialized: `query-context-${++nextId}` },
      getContact: async () => ({ pushname: 'Teste' }),
      reply: reply ?? (async (text: string) => { replies.push(text); }),
    } as unknown as Message);
    return replies;
  };
  const helpQueries = ['camara 14', 'coberto xyz', 'batreia 60', 'pneu 205 55 16', 'pneu coberto',
    '0 camara 14', '0 coberto xyz', '0 batreia 60'];
  const queries = [
    '205 55 16', '0 205 55 16', '0 175 70 14', '175 70', '0 175 70', '175 70 14 99', '0 175 70 14 99',
    'bateria 60', '0 bateria 60', 'câmara', 'câmara mt', '0 câmara', '0 câmara mt',
    'coberto', 'coberto mt', '0 coberto', '0 coberto mt', 'mt 21', '0 mt 21', 'baixo estoque', ...helpQueries,
  ];
  try {
    const first = await prisma.product.create({ data: {
      reference: '175/70 R14', description: 'PNEU A', stock: 5, minStock: 0,
      cashPrice: 100, creditPrice: 105.8,
    } });
    const second = await prisma.product.create({ data: {
      reference: '185/65 R15', description: 'PNEU B', stock: 4, minStock: 0,
      cashPrice: 200, creditPrice: 211.6,
    } });
    for (const query of queries) {
      await t.test(`cannot sell A after empty or invalid lookup: ${query}`, async () => {
        try {
          await send('175 70 14');
          await send('1');
          assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_action');
          await send(query);
          const replies = await send('venda 1 1');
          assert.equal(getSaleSession(userId, chatId), null, 'A must not remain selectable after B');
          assert.match(replies.join('\n'), /CONSULTA EXPIRADA/i);
          assert.equal(getLastQuery(userId, chatId), null);
          assert.equal(getProductActionSession(userId, chatId), null);
          assert.equal(await prisma.movement.count(), 0);
        } finally { clearAllOperationSessions(userId, chatId); }
      });
    }

    for (const query of queries.filter(value => !['175 70 14 99', '0 175 70 14 99', ...helpQueries].includes(value))) {
      await t.test(`query failure invalidates A: ${query}`, async st => {
        await send('175 70 14');
        const originalFind = prisma.product.findMany;
        prisma.product.findMany = (async () => { throw new Error('controlled query failure'); }) as typeof originalFind;
        const errors: unknown[][] = [];
        st.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args); });
        try {
          const replies = await send(query);
          assert.match(replies.join('\n'), /erro/i);
          assert.ok(errors.length > 0);
          assert.equal(getLastQuery(userId, chatId), null);
          assert.equal(getProductActionSession(userId, chatId), null);
        } finally { prisma.product.findMany = originalFind; clearAllOperationSessions(userId, chatId); }
      });
    }

    await t.test('failed delivery of a new result does not leave unseen selections active', async st => {
      await send('175 70 14');
      st.mock.method(console, 'error', () => {});
      await send('185 65 15', userId, chatId, async text => {
        if (text.includes('PNEU B')) throw new Error('controlled delivery failure');
      });
      assert.equal(getLastQuery(userId, chatId), null);
      assert.equal(getProductActionSession(userId, chatId), null);
    });

    await t.test('all indexed commands refuse an invalidated lookup', async () => {
      const previousLocations = env.inventoryLocationsEnabled;
      env.inventoryLocationsEnabled = true;
      try {
        for (const command of ['venda 1 1', 'entrada 1', 'preco 1', 'ajuste 1', 'local 1', 'nome 1', 'addfoto 1', 'foto 1']) {
          await send('175 70 14');
          await send('205 55 16');
          const replies = await send(command);
          assert.match(replies.join('\n'), /CONSULTA EXPIRADA|Consulte primeiro/i, command);
          assert.equal(getSaleSession(userId, chatId), null);
        }
      } finally { env.inventoryLocationsEnabled = previousLocations; clearAllOperationSessions(userId, chatId); }
    });

    await t.test('low-stock replacement discards the old action and allows a new explicit selection', async () => {
      await send('175 70 14');
      await send('1');
      await send('1');
      assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_sale_quantity');
      await prisma.product.update({ where: { id: second.id }, data: { minStock: 10 } });
      try {
        await send('baixo estoque');
        assert.equal(getLastQuery(userId, chatId)?.products[0]?.id, second.id);
        assert.equal(getProductActionSession(userId, chatId), null);
        await send('2');
        assert.equal(getSaleSession(userId, chatId), null);
        await send('venda 1 1');
        assert.equal(getSaleSession(userId, chatId)?.productId, second.id);
      } finally {
        clearAllOperationSessions(userId, chatId);
        await prisma.product.update({ where: { id: second.id }, data: { minStock: 0 } });
      }
    });

    await t.test('saving a replacement or empty list clears the selection from the previous context', () => {
      saveLastQuery(userId, chatId, 'A', []);
      assert.equal(getLastQuery(userId, chatId), null);
      saveProductActionSession(userId, chatId, 'awaiting_action', 1);
      saveLastQuery(userId, chatId, 'B', [{ ...second, cashPrice: 200, creditPrice: 211.6, tenInstallmentPrice: null }]);
      assert.equal(getProductActionSession(userId, chatId), null);
      assert.equal(getLastQuery(userId, chatId)?.products[0]?.id, second.id);
    });

    await t.test('queries from other users and chats run independently and do not invalidate each other', async () => {
      const previousPrivateMode = env.allowPrivateTestMode;
      env.allowPrivateTestMode = true;
      try {
        await Promise.all([send('175 70 14'), send('185 65 15', 'other-user'), send('185 65 15', userId, 'other-chat@c.us')]);
        await send('205 55 16');
        assert.equal(getLastQuery(userId, chatId), null);
        assert.equal(getLastQuery('other-user', chatId)?.products[0]?.id, second.id);
        assert.equal(getLastQuery(userId, 'other-chat@c.us')?.products[0]?.id, second.id);
      } finally { env.allowPrivateTestMode = previousPrivateMode; }
    });

    for (const scenario of ['empty', 'invalid', 'query error', 'delivery error']) {
      await t.test(`additional entry lookup discards its previous selection on ${scenario} and keeps prepared items`, async st => {
        const queried = { ...first, cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: null };
        const preparedItem = { productId: first.id, reference: first.reference, description: first.description,
          quantity: 1, supplier: 'Fornecedor teste', oldCashPrice: 100, oldCreditPrice: 105.8 };
        saveEntrySession({ userId, chatId, step: 'awaiting_additional_item', updatedAt: Date.now(),
          ...preparedItem, additionalMeasure: first.reference, additionalProducts: [queried], items: [preparedItem] });
        const originalFind = prisma.product.findMany;
        st.mock.method(console, 'error', () => {});
        if (scenario === 'query error') {
          prisma.product.findMany = (async () => { throw new Error('controlled query failure'); }) as typeof originalFind;
        }
        try {
          const body = scenario === 'empty' ? '205 55 16' : scenario === 'invalid' ? '175 70 14 99' : '185 65 15';
          await send(body, userId, chatId, async text => {
            if (scenario === 'delivery error' && text.includes('PNEU B')) throw new Error('controlled delivery failure');
          });
          assert.equal(getEntrySession(userId, chatId)?.additionalProducts?.length ?? 0, 0);
          assert.deepEqual(getEntrySession(userId, chatId)?.items, [preparedItem]);
          await send('1');
          assert.notEqual(getEntrySession(userId, chatId)?.step, 'awaiting_quantity');
          await send('voltar');
          if (getEntrySession(userId, chatId)?.step === 'awaiting_additional_measure') await send('voltar');
          assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_additional_decision');
          assert.deepEqual(getEntrySession(userId, chatId)?.items, [preparedItem]);
        } finally { prisma.product.findMany = originalFind; clearAllOperationSessions(userId, chatId); }
      });
    }

    await t.test('additional sale result that could not be delivered is not selectable and keeps the cart', async st => {
      const item = { productId: first.id, reference: first.reference, description: first.description,
        quantity: 1, cashPrice: 100, creditPrice: 105.8, priceType: 'À vista' as const, unitPrice: 100, totalValue: 100 };
      saveSaleSession({ ...item, userId, chatId, step: 'awaiting_additional_measure', items: [item], updatedAt: Date.now() });
      st.mock.method(console, 'error', () => {});
      try {
        try {
          await send('185 65 15', userId, chatId, async text => {
            if (text.includes('PNEU B')) throw new Error('controlled delivery failure');
          });
        } catch (error) { assert.match(String(error), /controlled delivery failure/); }
        assert.equal(getSaleSession(userId, chatId)?.additionalProducts, undefined);
        await send('1');
        assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_additional_measure');
        await send('voltar');
        assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_payment');
        assert.deepEqual(getSaleSession(userId, chatId)?.items, [item]);
      } finally { clearAllOperationSessions(userId, chatId); }
    });

    await t.test('a fresh valid lookup selects B, cancellation keeps the valid list, and normal sale persists once', async () => {
      await send('205 55 16');
      await send('185 65 15');
      await send('1');
      await send('cancelar');
      assert.equal(getProductActionSession(userId, chatId), null);
      assert.equal(getLastQuery(userId, chatId)?.products[0]?.id, second.id);
      await send('venda 1 1');
      assert.equal(getSaleSession(userId, chatId)?.productId, second.id);
      await send('cancelar');
      assert.equal(getSaleSession(userId, chatId), null);
      await send('venda 1 1');
      await send('1'); // Cash price.
      await send('1'); // Cash payment outside Monteiro.
      assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_confirmation');
      await send('confirmar');
      assert.equal(getSaleSession(userId, chatId), null);
      assert.equal(await prisma.movement.count({ where: { productId: second.id, type: 'SALE' } }), 1);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: second.id } })).stock, 3);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: first.id } })).stock, 5);
    });

    await t.test('an expired query cannot start a sale and a new query restores selection', async () => {
      await send('175 70 14');
      const originalNow = Date.now;
      const now = Date.now();
      try {
        Date.now = () => now + LAST_QUERY_TTL_MS + 1;
        const replies = await send('venda 1 1');
        assert.match(replies.join('\n'), /CONSULTA EXPIRADA/i);
        assert.equal(getSaleSession(userId, chatId), null);
      } finally { Date.now = originalNow; }
      await send('175 70 14');
      await send('1');
      assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_action');
    });
  } finally {
    clearAllOperationSessions(userId, chatId);
    clearLastQuery(userId);
    clearLastQuery('other-user');
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
