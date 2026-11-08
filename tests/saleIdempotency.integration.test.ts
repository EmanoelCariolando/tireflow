import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import type { Message } from 'whatsapp-web.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('a committed sale can be retried after a failed reply without repeating stock, revenue or commission', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-sale-idempotency-'));
  const database = path.join(root, 'test.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { prisma } = await import('../src/database/prisma.js');
  const { registerSaleItems } = await import('../src/services/saleService.js');
  const { runPostCommitTask } = await import('../src/services/postCommitTask.js');
  try {
    const product = await prisma.product.create({ data: {
      reference: '175/70 R14', description: 'SYNTHETIC', stock: 5, cashPrice: 100, creditPrice: 105.8,
    } });
    const input = {
      operationId: 'synthetic-operation-1', sellerPhone: 'synthetic-user', sellerName: 'Synthetic',
      paymentMethod: 'Dinheiro' as const, totalValue: 100,
      items: [{ productId: product.id, quantity: 1, unitPrice: 100, totalValue: 100 }],
    };
    const first = await registerSaleItems(input);
    assert.equal(await runPostCommitTask('synthetic sale reply', async () => { throw new Error('Synthetic reply failure'); }), false);
    const retry = await registerSaleItems(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(retry, first);
    const restarted = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
      env: process.env, encoding: 'utf8', timeout: 15000,
      input: `const { registerSaleItems } = await import('./src/services/saleService.ts');
        const { prisma } = await import('./src/database/prisma.ts');
        try { console.log(JSON.stringify(await registerSaleItems(${JSON.stringify(input)}))); }
        finally { await prisma.$disconnect(); }`,
    });
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.deepEqual(JSON.parse(restarted.stdout.trim().split('\n').at(-1)!), first);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 4);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 1);
    const movement = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE' } });
    assert.equal(Number(movement.totalValue), 100);
    assert.equal(Number(movement.commissionPercent), 2);
    await assert.rejects(registerSaleItems({ ...input, totalValue: 90,
      items: [{ ...input.items[0], totalValue: 90, unitPrice: 90 }] }));
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 1);
    const secondInput = { ...input, operationId: 'synthetic-operation-2' };
    const [second, sameSecond] = await Promise.all([registerSaleItems(secondInput), registerSaleItems(secondInput)]);
    assert.deepEqual(second, sameSecond);
    assert.notEqual(second.saleGroupCode, first.saleGroupCode);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 3);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 2);

    const { saveSaleSession, getSaleSession } = await import('../src/utils/saleSessionStore.js');
    const { handleSaleConversation } = await import('../src/commands/saleCommand.js');
    const userId = '5583000000001@c.us';
    const chatId = '120363000000001@g.us';
    saveSaleSession({ userId, chatId, step: 'awaiting_confirmation', productId: product.id,
      reference: product.reference, description: product.description, quantity: 1,
      cashPrice: 100, creditPrice: 105.8, unitPrice: 100, totalValue: 100,
      paymentMethod: 'Dinheiro', priceType: 'À vista', updatedAt: Date.now() });
    const savedSession = getSaleSession(userId, chatId)!;
    assert.ok(savedSession.operationId);
    const message = { author: userId, from: chatId, body: 'confirmar',
      getContact: async () => ({ pushname: 'Synthetic' }),
      reply: async () => { throw new Error('Synthetic committed-sale reply failure'); },
    } as unknown as Message;
    await handleSaleConversation(message, 'confirmar');
    assert.equal(getSaleSession(userId, chatId), null);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
    saveSaleSession(savedSession);
    await handleSaleConversation(message, 'confirmar');
    assert.equal(getSaleSession(userId, chatId), null);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 3);

    saveSaleSession({ ...savedSession, operationId: 'synthetic-ambiguous-sale' });
    const safeMessage = { ...message, reply: async () => {} } as unknown as Message;
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = (async (...args: unknown[]) => {
      await (originalTransaction as (...values: unknown[]) => Promise<unknown>).apply(prisma, args);
      throw new Error('Synthetic lost result after COMMIT');
    }) as typeof prisma.$transaction;
    try {
      await handleSaleConversation(safeMessage, 'confirmar');
    } finally {
      prisma.$transaction = originalTransaction;
    }
    assert.equal(getSaleSession(userId, chatId)?.operationId, 'synthetic-ambiguous-sale');
    assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_confirmation');
    await handleSaleConversation(safeMessage, 'confirmar');
    assert.equal(getSaleSession(userId, chatId), null);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 1);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 4);

    const { registerPendingSale } = await import('../src/services/pendingSaleService.js');
    const pending = await registerPendingSale({ createdByPhone: userId, createdByName: 'Synthetic',
      assignedPhone: userId, assignedName: 'Synthetic', totalValue: 100,
      items: [{ productId: product.id, reference: product.reference, description: product.description,
        quantity: 1, cashPrice: 100, creditPrice: 105.8, priceType: 'À vista', unitPrice: 100, totalValue: 100 }] });
    const pendingInput = { ...input, operationId: 'synthetic-ambiguous-pending', sellerPhone: userId,
      pendingSaleId: pending.id, totalValue: 90, allowPendingPriceChange: true,
      items: [{ productId: product.id, quantity: 1, unitPrice: 90, totalValue: 90 }] };
    prisma.$transaction = (async (...args: unknown[]) => {
      await (originalTransaction as (...values: unknown[]) => Promise<unknown>).apply(prisma, args);
      throw new Error('Synthetic lost pending-settlement result after COMMIT');
    }) as typeof prisma.$transaction;
    try {
      await assert.rejects(registerSaleItems(pendingInput), /Synthetic lost pending/);
    } finally {
      prisma.$transaction = originalTransaction;
    }
    const settled = await registerSaleItems(pendingInput);
    assert.deepEqual(await registerSaleItems(pendingInput), settled);
    assert.equal((await prisma.pendingSale.findUniqueOrThrow({ where: { id: pending.id } })).status, 'SOLD');
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 0);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 5);
    assert.equal(Number((await prisma.movement.findUniqueOrThrow({ where: { code: settled.items[0].movementCode } })).commissionPercent), 1);
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
