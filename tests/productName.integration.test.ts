import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';

test('corrects product names through the menu with confirmation, duplicate and concurrency checks', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-product-name-'));
  const databasePath = path.join(temporaryRoot, 'names.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  await writeFile(databasePath, '');
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  process.env.DATABASE_URL = databaseUrl;
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { saveLastQuery, getLastQuery, clearLastQuery } = await import('../src/utils/lastQueryStore.js');
  const { saveProductActionSession } = await import('../src/utils/productActionSessionStore.js');
  const { getProductNameSession } = await import('../src/utils/productNameSessionStore.js');
  const { clearAllOperationSessions, hasActiveOperationSession } = await import('../src/utils/operationSessionCoordinator.js');
  const { renameProduct, InvalidProductNameError, ProductNameNotFoundError } = await import('../src/services/productNameService.js');
  const { productRepository } = await import('../src/repositories/productRepository.js');
  const previousGroup = env.whatsappOfficialGroupId;
  const previousLocations = env.inventoryLocationsEnabled;
  const userId = 'rename-user';
  const chatId = 'rename-group@g.us';
  const replies: string[] = [];
  const send = (body: string) => handleIncomingMessage({
    author: userId, from: chatId, body, hasMedia: false,
    reply: async (text: string) => { replies.push(text); return undefined; },
  } as unknown as Message);

  try {
    env.whatsappOfficialGroupId = chatId;
    env.inventoryLocationsEnabled = false;
    const product = await prisma.product.create({ data: {
      reference: '175/70 R14', description: 'NOME INCORRETO', stock: 4,
      cashPrice: 300, creditPrice: 320, tenInstallmentPrice: 350, stockLocation: 'W3',
    } });
    const cachedProduct = {
      ...product, cashPrice: 300, creditPrice: 320, tenInstallmentPrice: 350,
    };
    saveLastQuery(userId, chatId, product.reference, [cachedProduct]);
    saveLastQuery('other-user', 'other-chat', product.reference, [cachedProduct]);
    saveProductActionSession(userId, chatId, 'awaiting_action', 1);
    await send('7');
    assert.equal(getProductNameSession(userId, chatId)?.step, 'awaiting_name');
    assert.equal(hasActiveOperationSession(userId, chatId), true);
    assert.match(replies.at(-1)!, /Nome atual: \*NOME INCORRETO\*/);

    await send('x');
    await send('a'.repeat(121));
    assert.equal(getProductNameSession(userId, chatId)?.step, 'awaiting_name');
    await send('  Nome   Incorreto  ');
    assert.match(replies.at(-1)!, /já é o nome atual/);
    await send('nome temporário');
    await send('2');
    assert.equal(getProductNameSession(userId, chatId)?.step, 'awaiting_name');
    await send('  Pirelli   modelo correto  ');
    assert.match(replies.at(-1)!, /Novo nome: \*PIRELLI MODELO CORRETO\*/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).description, product.description);
    await send('nome 2');
    assert.match(replies.at(-1)!, /operação em andamento/i);
    await send('1');
    const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(updated.description, 'PIRELLI MODELO CORRETO');
    assert.deepEqual({ ...updated, description: product.description, updatedAt: product.updatedAt }, product);
    assert.equal(await prisma.movement.count(), 0);
    assert.equal(getProductNameSession(userId, chatId), null);
    assert.equal(hasActiveOperationSession(userId, chatId), false);
    assert.equal(getLastQuery(userId, chatId)?.products[0]?.description, updated.description);
    assert.equal(getLastQuery('other-user', 'other-chat')?.products[0]?.description, updated.description);

    await prisma.product.create({ data: {
      reference: '175/70/14', description: 'NOME OCUPADO', cashPrice: 300, creditPrice: 320,
    } });
    await send('nome 1');
    await send('nome ocupado');
    await send('confirmar');
    assert.equal(getProductNameSession(userId, chatId)?.step, 'awaiting_name');
    assert.match(replies.at(-1)!, /Já existe um produto/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).description, updated.description);
    await send('outro nome');
    await send('0');
    assert.equal(getProductNameSession(userId, chatId), null);

    await send('nome 1');
    await send('nome de uma sessão antiga');
    await renameProduct({ productId: product.id, expectedDescription: updated.description, newDescription: 'Correção de outra pessoa' });
    await send('confirmar');
    assert.match(replies.at(-1)!, /Faça uma nova consulta/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).description, 'CORREÇÃO DE OUTRA PESSOA');
    assert.equal(getProductNameSession(userId, chatId), null);

    saveLastQuery(userId, chatId, product.reference, [{ ...cachedProduct, description: 'CORREÇÃO DE OUTRA PESSOA' }]);
    await send('nome 1');
    await send('Nome após tentar novamente');
    const originalUpdate = productRepository.updateDescriptionIfUnchanged;
    try {
      productRepository.updateDescriptionIfUnchanged = () => { throw new Error('Simulated write failure'); };
      await send('confirmar');
      assert.equal(getProductNameSession(userId, chatId)?.step, 'awaiting_confirmation');
    } finally {
      productRepository.updateDescriptionIfUnchanged = originalUpdate;
    }
    await send('confirmar');
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).description, 'NOME APÓS TENTAR NOVAMENTE');
    assert.equal(getProductNameSession(userId, chatId), null);
    await assert.rejects(renameProduct({ productId: product.id, expectedDescription: 'unused', newDescription: 'x' }), InvalidProductNameError);
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
    await assert.rejects(renameProduct({ productId: product.id, expectedDescription: 'unused', newDescription: 'Novo nome' }), ProductNameNotFoundError);
    await assert.rejects(renameProduct({ productId: 'missing', expectedDescription: 'unused', newDescription: 'Novo nome' }), ProductNameNotFoundError);
  } finally {
    env.whatsappOfficialGroupId = previousGroup;
    env.inventoryLocationsEnabled = previousLocations;
    clearAllOperationSessions(userId, chatId);
    clearLastQuery(userId, chatId);
    clearLastQuery('other-user', 'other-chat');
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
