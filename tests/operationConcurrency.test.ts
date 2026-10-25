import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('routes overlapping operation messages safely on isolated SQLite', { timeout: 30000 }, async t => {
  assert.equal(process.env.NODE_ENV, 'test', 'Use npm test so installation data stays isolated.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-concurrency-'));
  const database = path.join(root, 'operations.db');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { saveSaleSession, getSaleSession } = await import('../src/utils/saleSessionStore.js');
  const { saveAddPhotoSession } = await import('../src/utils/addPhotoSessionStore.js');
  const { clearAllOperationSessions } = await import('../src/utils/operationSessionCoordinator.js');
  const { getMenuSession, clearMenuSession } = await import('../src/utils/menuSessionStore.js');
  const { EMPLOYEE_SESSION_TTL_MS } = await import('../src/utils/employeeSessionDuration.js');
  const chatId = env.whatsappOfficialGroupId;
  let nextId = 0;
  function message(userId: string, body: string, replies: string[], overrides: Record<string, unknown> = {}): Message {
    const from = typeof overrides.from === 'string' ? overrides.from : chatId;
    return {
      author: from.endsWith('@g.us') ? userId : undefined, from, fromMe: false, body, type: 'chat', hasMedia: false,
      id: { id: String(++nextId), _serialized: `concurrency-${nextId}`, remote: from, fromMe: false },
      reply: async (text: string) => { replies.push(text); },
      getContact: async () => ({ pushname: 'Vendedor teste' }), ...overrides,
    } as unknown as Message;
  }

  try {
    for (const paymentMethod of ['Dinheiro', 'Nota', 'Misto'] as const) {
      await t.test(`rejects cancellation and duplicate confirmation while a ${paymentMethod} sale is running`, async () => {
        const userId = { Dinheiro: '5583000000051@c.us', Nota: '5583000000052@c.us', Misto: '5583000000053@lid' }[paymentMethod];
        const product = await prisma.product.create({ data: {
          reference: '175/70/14', description: `PNEU ${paymentMethod}`, stock: 3,
          cashPrice: 100, creditPrice: 110,
        } });
        saveSaleSession({
          userId, chatId, productId: product.id, reference: product.reference,
          description: product.description, quantity: 1, cashPrice: 100, creditPrice: 110,
          step: 'awaiting_confirmation', updatedAt: Date.now(), paymentMethod,
          priceType: paymentMethod === 'Nota' ? 'A prazo' : 'À vista',
          unitPrice: paymentMethod === 'Nota' ? 110 : 100,
          totalValue: paymentMethod === 'Nota' ? 110 : 100,
          paymentBreakdown: paymentMethod === 'Misto'
            ? [{ method: 'Dinheiro', amount: 40 }, { method: 'PIX', amount: 60 }] : undefined,
          invoiceName: paymentMethod === 'Nota' ? 'Cliente teste' : undefined,
          invoiceNumber: paymentMethod === 'Nota' ? '123' : undefined,
        });
        const entered = deferred();
        const release = deferred();
        const committed = deferred();
        const finishReply = deferred();
        const replies: string[] = [];
        const running = handleIncomingMessage(message(userId, 'confirmar', replies, {
          getContact: async () => { entered.resolve(); await release.promise; return { pushname: 'Teste' }; },
          reply: async (text: string) => {
            replies.push(text);
            if (/VENDA REGISTRADA/i.test(text)) { committed.resolve(); await finishReply.promise; }
          },
        }));
        try {
          await entered.promise;
          for (const body of ['cancelar', '0', 'confirmar', 'menu', 'pneu 1757014']) {
            const concurrentReplies: string[] = [];
            await handleIncomingMessage(message(userId, body, concurrentReplies));
            assert.equal(concurrentReplies.length, 1);
            assert.match(concurrentReplies[0]!, /processando.*aguarde/is);
            assert.doesNotMatch(concurrentReplies[0]!, /operação cancelada/i);
          }
          assert.equal(getSaleSession(userId, chatId)?.step, 'processing');
          assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 0);
          // Another employee must remain free to use the same group.
          const otherReplies: string[] = [];
          await handleIncomingMessage(message('5583000000054@c.us', 'menu', otherReplies));
          assert.match(otherReplies[0]!, /TIREFLOW — MENU/);
          release.resolve();
          await committed.promise;
          assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
          // A committed write still owns its session until notification and cleanup finish.
          for (const body of ['cancelar', 'menu']) {
            const postCommitReplies: string[] = [];
            await handleIncomingMessage(message(userId, body, postCommitReplies));
            assert.match(postCommitReplies[0]!, /processando.*aguarde/is);
          }
          assert.equal(getMenuSession(userId, chatId), null);
        } finally {
          release.resolve();
          finishReply.resolve();
          await running;
        }
        assert.equal(await prisma.movement.count({ where: { productId: product.id, type: 'SALE' } }), 1);
        const movement = await prisma.movement.findFirstOrThrow({ where: { productId: product.id } });
        assert.equal(movement.paymentMethod, paymentMethod);
        assert.equal(Number(movement.totalValue), paymentMethod === 'Nota' ? 110 : 100);
        if (paymentMethod === 'Misto') assert.deepEqual(JSON.parse(movement.paymentDetails!), [
          { method: 'Dinheiro', amount: 40 }, { method: 'PIX', amount: 60 },
        ]);
        assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
        assert.equal(getSaleSession(userId, chatId), null);
        assert.ok(replies.some(text => /VENDA REGISTRADA/i.test(text)));
        await handleIncomingMessage(message(userId, 'menu', replies));
        assert.ok(getMenuSession(userId, chatId));
        clearMenuSession(userId, chatId);
      });
    }

    await t.test('does not accept cancellation or session replacement while a photo is downloading, even after TTL', async () => {
      const userId = '5583000000055@c.us';
      const product = await prisma.product.create({ data: {
        reference: '175/70/14', description: 'PNEU FOTO', stock: 1, cashPrice: 100, creditPrice: 110,
      } });
      saveAddPhotoSession({ userId, chatId, productId: product.id, itemNumber: 1,
        description: product.description, step: 'awaiting_image', startedAt: Date.now() });
      const entered = deferred();
      const release = deferred();
      const replies: string[] = [];
      const running = handleIncomingMessage(message(userId, '', replies, {
        type: 'image', hasMedia: true,
        downloadMedia: async () => {
          entered.resolve(); await release.promise;
          return { mimetype: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64') };
        },
      }));
      const realNow = Date.now;
      try {
        await entered.promise;
        Date.now = () => realNow() + EMPLOYEE_SESSION_TTL_MS + 1;
        for (const body of ['cancelar', 'menu']) {
          const concurrentReplies: string[] = [];
          await handleIncomingMessage(message(userId, body, concurrentReplies));
          assert.match(concurrentReplies[0]!, /processando.*aguarde/is);
        }
      } finally {
        Date.now = realNow;
        release.resolve();
        await running;
      }
      assert.ok((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imagePath);
      assert.ok(replies.some(text => /Foto adicionada com sucesso/i.test(text)));
      // New state can be created only after the old handler has completed its cleanup.
      await handleIncomingMessage(message(userId, 'menu', replies));
      assert.ok(getMenuSession(userId, chatId));
      clearMenuSession(userId, chatId);
    });

    await t.test('keeps cancellation available before confirmation without changing stock', async () => {
      const userId = '5583000000056@c.us';
      const before = await prisma.movement.count();
      saveSaleSession({ userId, chatId, productId: 'unused-product', reference: '175/70/14',
        description: 'PNEU', quantity: 1, cashPrice: 100, creditPrice: 110,
        step: 'awaiting_confirmation', updatedAt: Date.now() });
      const replies: string[] = [];
      await handleIncomingMessage(message(userId, 'cancelar', replies));
      assert.match(replies[0]!, /operação cancelada/i);
      assert.equal(getSaleSession(userId, chatId), null);
      assert.equal(await prisma.movement.count(), before);
    });

    await t.test('releases ownership after a handler fails and isolates the same user across chats', async () => {
      const userId = '5583000000057@c.us';
      await assert.rejects(handleIncomingMessage(message(userId, 'menu', [], {
        reply: async () => { throw new Error('controlled reply failure'); },
      })), /controlled reply failure/);
      const entered = deferred();
      const release = deferred();
      const running = handleIncomingMessage(message(userId, 'menu', [], {
        reply: async () => { entered.resolve(); await release.promise; },
      }));
      const previousPrivateMode = env.allowPrivateTestMode;
      try {
        await entered.promise;
        env.allowPrivateTestMode = true;
        const replies: string[] = [];
        await handleIncomingMessage(message(userId, 'menu', replies, { from: userId }));
        assert.match(replies[0]!, /TIREFLOW — MENU/);
      } finally {
        env.allowPrivateTestMode = previousPrivateMode;
        release.resolve();
        await running;
        clearAllOperationSessions(userId, chatId);
        clearMenuSession(userId, chatId);
        clearMenuSession(userId, userId);
      }
    });
  } finally {
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
