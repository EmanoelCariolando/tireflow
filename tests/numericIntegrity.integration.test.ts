import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';

test('invalid numeric input never changes isolated stock, prices or movements', async t => {
  assert.equal(process.env.NODE_ENV, 'test', 'Use npm test for isolation.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-numeric-integrity-'));
  const database = path.join(root, 'numeric.db');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { savePriceSession, getPriceSession } = await import('../src/utils/priceSessionStore.js');
  const { saveAdjustmentSession, getAdjustmentSession } = await import('../src/utils/adjustmentSessionStore.js');
  const { clearAllOperationSessions } = await import('../src/utils/operationSessionCoordinator.js');
  const { registerPriceChange } = await import('../src/services/priceService.js');
  const { registerNewProduct } = await import('../src/services/productRegistrationService.js');
  const { registerAdjustment, registerStockTransfer } = await import('../src/services/adjustmentService.js');
  const { registerEntry } = await import('../src/services/entryService.js');
  const { registerSale } = await import('../src/services/saleService.js');
  const { registerPendingSale } = await import('../src/services/pendingSaleService.js');
  const userId = 'numeric-user';
  const chatId = env.whatsappOfficialGroupId;
  const responsible = { responsiblePhone: userId, responsibleName: 'Teste' };
  let nextId = 0;
  const makeProduct = () => prisma.product.create({ data: {
    reference: '175/70 R14', description: `NUMERICO ${++nextId}`, stock: 5, minStock: 0, cashPrice: 100, creditPrice: 105.8,
  } });
  const send = (body: string, replies: string[], media = false) => handleIncomingMessage({
    author: userId, from: chatId, body, hasMedia: media, type: media ? 'image' : 'chat',
    id: { _serialized: `numeric-${++nextId}` }, getContact: async () => ({ pushname: 'Teste' }),
    reply: async (text: string) => { replies.push(text); },
  } as unknown as Message);
  try {
    for (const input of ['', '   ', '0x10', '1e3', '-1', '9'.repeat(100)]) {
      await t.test(`missing or invalid WhatsApp price cannot be confirmed: ${JSON.stringify(input)}`, async () => {
        const product = await makeProduct();
        const replies: string[] = [];
        try {
          savePriceSession({ userId, chatId, productId: product.id, reference: product.reference, description: product.description,
            oldCashPrice: 100, oldCreditPrice: 105.8, stock: 5, step: 'awaiting_cash_price', updatedAt: Date.now() });
          await send(input, replies, input.trim() === '');
          assert.equal(getPriceSession(userId, chatId)?.step, 'awaiting_cash_price');
          assert.equal(getPriceSession(userId, chatId)?.newCashPrice, undefined);
          await send('confirmar', replies);
          assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).cashPrice), 100);
          assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 0);
        } finally { clearAllOperationSessions(userId, chatId); }
      });
    }

    await t.test('media without caption cannot zero a counted balance, while an explicit zero remains valid', async () => {
      const product = await makeProduct();
      const replies: string[] = [];
      try {
        saveAdjustmentSession({ userId, chatId, productId: product.id, reference: product.reference, description: product.description,
          previousStock: 5, step: 'awaiting_new_stock', updatedAt: Date.now() });
        await send('', replies, true);
        assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_new_stock');
        await send('0', replies);
        assert.equal(getAdjustmentSession(userId, chatId)?.newStock, 0);
        await send('Conferência de teste', replies);
        await send('confirmar', replies);
        assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 0);
        assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
      } finally { clearAllOperationSessions(userId, chatId); }
    });

    for (const [input, expectedPrice] of [
      ['0,00', 0], ['1.000', 1000], ['1,299.90', 1299.9], ['1000.123', 1000.12], ['1.0050', 1.01],
    ] as const) {
    await t.test(`explicit price ${input} persists the approved amount only after confirmation`, async () => {
      const product = await makeProduct();
      const replies: string[] = [];
      try {
        savePriceSession({ userId, chatId, productId: product.id, reference: product.reference, description: product.description,
          oldCashPrice: 100, oldCreditPrice: 105.8, stock: 5, step: 'awaiting_cash_price', updatedAt: Date.now() });
        await send(input, replies);
        assert.equal(getPriceSession(userId, chatId)?.newCashPrice, expectedPrice);
        assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).cashPrice), 100);
        await send('confirmar', replies);
        const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        assert.equal(Number(after.cashPrice), expectedPrice);
        assert.equal(Number(after.creditPrice), Math.round(expectedPrice * 1.058 * 100) / 100);
        assert.equal(after.stock, 5);
        assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
      } finally { clearAllOperationSessions(userId, chatId); }
    });
    }

    for (const value of [-1, NaN, Infinity, 1e100]) {
      await t.test(`price service rejects invalid values before writing: ${String(value)}`, async () => {
        const product = await makeProduct();
        await assert.rejects(registerPriceChange({ ...responsible, productId: product.id,
          oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: value }));
        const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        assert.equal(Number(after.cashPrice), 100);
        assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 0);
      });
    }
    await t.test('adjustment service rejects a negative balance without mutation', async () => {
      const product = await makeProduct();
      await assert.rejects(registerAdjustment({ ...responsible, productId: product.id, newStock: -1, reason: 'Teste' }));
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 5);
      assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 0);
    });
    for (const [initialStock, cashPrice] of [[-1, 100], [0, -1], [2147483648, 100], [0, 1e100]]) {
      await t.test(`registration service rejects invalid stock/price ${initialStock}/${cashPrice}`, async () => {
        const description = `INVALID REGISTRATION ${++nextId}`;
        await assert.rejects(registerNewProduct({ ...responsible, reference: '205/55 R16', description,
          initialStock: initialStock!, cashPrice: cashPrice!, supplier: 'Teste' }));
        assert.equal(await prisma.product.count({ where: { description } }), 0);
      });
    }
    await t.test('entry and transfer reject stock overflow atomically', async () => {
      const target = await makeProduct();
      const source = await makeProduct();
      await prisma.product.update({ where: { id: target.id }, data: { stock: 2147483647 } });
      await assert.rejects(registerEntry({ ...responsible, productId: target.id, quantity: 1, supplier: 'Teste' }));
      await assert.rejects(registerStockTransfer({ ...responsible, sourceProductId: source.id, targetProductId: target.id,
        quantity: 1, reason: 'Teste' }));
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: target.id } })).stock, 2147483647);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: source.id } })).stock, 5);
      assert.equal(await prisma.movement.count({ where: { productId: { in: [source.id, target.id] } } }), 0);
    });
    await t.test('pending sale rejects negative totals without reserving stock', async () => {
      const product = await makeProduct();
      await assert.rejects(registerPendingSale({ createdByPhone: userId, createdByName: 'Teste',
        assignedPhone: userId, assignedName: 'Teste', totalValue: -100,
        items: [{ productId: product.id, reference: product.reference, description: product.description,
          quantity: 1, cashPrice: 100, creditPrice: 105.8, unitPrice: -100, totalValue: -100, priceType: 'À vista' }] }));
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 5);
      assert.equal(await prisma.pendingSale.count({ where: { items: { some: { productId: product.id } } } }), 0);
    });
    for (const paymentMethod of ['Dinheiro', 'Nota', 'Misto'] as const) {
      await t.test(`valid ${paymentMethod} sale retains cents and fractional discounted unit price`, async () => {
        const product = await makeProduct();
        await registerSale({ productId: product.id, sellerPhone: userId, sellerName: 'Teste', quantity: 3,
          unitPrice: 29 / 3, totalValue: 29, paymentMethod,
          paymentBreakdown: paymentMethod === 'Misto' ? [{ method: 'Dinheiro', amount: 10.01 }, { method: 'PIX', amount: 18.99 }] : undefined });
        const sale = await prisma.movement.findFirstOrThrow({ where: { productId: product.id, type: 'SALE' } });
        assert.equal(Number(sale.totalValue), 29);
        assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
        assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
        if (paymentMethod === 'Misto') assert.deepEqual(JSON.parse(sale.paymentDetails!), [
          { method: 'Dinheiro', amount: 10.01 }, { method: 'PIX', amount: 18.99 },
        ]);
      });
    }
  } finally {
    clearAllOperationSessions(userId, chatId);
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
