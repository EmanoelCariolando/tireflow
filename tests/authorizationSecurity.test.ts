import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Message } from 'whatsapp-web.js';

test('authorization protects identity and sessions on disposable SQLite', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-authorization-'));
  const database = path.join(root, 'authorization.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { saveSaleSession, getSaleSession } = await import('../src/utils/saleSessionStore.js');
  const { getMenuSession } = await import('../src/utils/menuSessionStore.js');
  const { clearAllOperationSessions } = await import('../src/utils/operationSessionCoordinator.js');
  const { saveEntrySession, getEntrySession } = await import('../src/utils/entrySessionStore.js');
  const group = '120363000000001@g.us';
  const user = '5583000000001@c.us';
  const other = '5583000000002@lid';
  const previous = { ...env };
  let nextId = 0;
  const message = (author: string, from: string, body: string, overrides: Record<string, unknown> = {}) => {
    const replies: string[] = [];
    const id = `authorization-${++nextId}`;
    return { replies, value: {
      author: from.endsWith('@g.us') ? author : undefined, from, fromMe: false,
      body, type: 'chat', hasMedia: false, isStatus: false,
      id: { id, _serialized: `false_${from}_${id}`, remote: from, fromMe: false },
      reply: async (text: string) => { replies.push(text); },
      getContact: async () => ({ pushname: 'Teste' }),
      getChat: async () => { assert.fail('Authorization must not depend on participant roles or group names.'); },
      ...overrides,
    } as unknown as Message };
  };
  const prepareSale = async (author = user, chatId = group) => {
    const product = await prisma.product.create({ data: {
      reference: '175/70 R14', description: `AUTH ${++nextId}`, stock: 5, cashPrice: 100, creditPrice: 105.8,
    } });
    saveSaleSession({ userId: author, chatId, productId: product.id, reference: product.reference,
      description: product.description, quantity: 1, cashPrice: 100, creditPrice: 105.8,
      priceType: 'À vista', unitPrice: 100, totalValue: 100, paymentMethod: 'Dinheiro',
      step: 'awaiting_confirmation', updatedAt: Date.now() });
    return product;
  };
  const assertUntouched = async (productId: string) => {
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock, 5);
    assert.equal(await prisma.movement.count({ where: { productId } }), 0);
  };
  try {
    env.whatsappOfficialGroupId = group;
    env.allowPrivateTestMode = false;
    for (const [index, role, isActive] of [[1, 'USER', true], [2, 'USER', false], [3, 'ADMIN', false], [4, 'OUTRA', true]] as const) {
      await t.test(`group participant role=${role} active=${isActive} can sell without changing activity`, async () => {
        const author = `55830000001${index}@c.us`;
        await prisma.user.create({ data: { phone: author, name: 'Teste', role, isActive } });
        const product = await prepareSale(author);
        await handleIncomingMessage(message(author, group, 'confirmar').value);
        assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
        const persisted = await prisma.user.findUniqueOrThrow({ where: { phone: author } });
        assert.equal(persisted.isActive, isActive);
        assert.equal(persisted.role, role);
      });
    }
    await t.test('an unknown group participant retains the default new-user registration', async () => {
      const author = '5583000000099@lid';
      const product = await prepareSale(author);
      await handleIncomingMessage(message(author, group, 'confirmar').value);
      assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { phone: author } });
      assert.equal(persisted.isActive, true);
      assert.equal(persisted.role, 'USER');
    });
    const invalid: Array<[string, Record<string, unknown>]> = [
      ['missing author', { author: undefined }], ['group as author', { author: group }],
      ['malformed author', { author: 'not-an-identity' }], ['missing conversation', { from: undefined }],
      ['malformed conversation', { from: `${group}.invalid` }],
      ['mismatched remote', { id: { id: 'x', _serialized: 'x', remote: '120363000000009@g.us', fromMe: false } }],
      ['missing message id', { id: undefined }],
      ['missing remote', { id: { id: 'x', _serialized: 'x', fromMe: false } }],
      ['non-string remote', { id: { id: 'x', remote: { _serialized: group }, fromMe: false } }],
      ['non-string serialized id', { id: { id: 'x', _serialized: 0, remote: group, fromMe: false } }],
      ['empty internal id', { id: { id: '', _serialized: 'x', remote: group, fromMe: false } }],
      ['empty serialized id', { id: { id: 'x', _serialized: ' ', remote: group, fromMe: false } }],
      ['missing id ownership', { id: { id: 'x', _serialized: 'x', remote: group } }],
      ['contradictory ownership', { fromMe: false, id: { id: 'x', _serialized: 'x', remote: group, fromMe: true } }],
      ['missing ownership', { fromMe: undefined }], ['status message', { isStatus: true }],
      ['broadcast message', { broadcast: true }], ['message sent by the bot', { fromMe: true }],
      ['unsupported channel', { from: '123456789@newsletter', id: { id: 'x', _serialized: 'x', remote: '123456789@newsletter', fromMe: false } }],
      ['unsupported broadcast source', { from: '123456789@broadcast', id: { id: 'x', _serialized: 'x', remote: '123456789@broadcast', fromMe: false } }],
    ];
    for (const [name, overrides] of invalid) {
      await t.test(`rejects ${name} before any write or session cancellation`, async () => {
        const product = await prepareSale();
        try {
          const m = message(user, group, 'confirmar', overrides);
          await handleIncomingMessage(m.value);
          await handleIncomingMessage(message(user, group, 'cancelar', overrides).value);
          const menu = message(user, group, 'menu', overrides);
          await handleIncomingMessage(menu.value);
          await assertUntouched(product.id);
          assert.equal(getSaleSession(user, group)?.step, 'awaiting_confirmation');
          assert.deepEqual(m.replies, []);
          assert.deepEqual(menu.replies, []);
          assert.equal(getMenuSession(group, group), null);
        } finally { clearAllOperationSessions(user, group); }
      });
    }
    await t.test('another user or conversation cannot confirm or cancel the original sale', async () => {
      const product = await prepareSale();
      env.allowPrivateTestMode = true;
      try {
        for (const body of ['confirmar', 'cancelar']) {
          await handleIncomingMessage(message(other, group, body).value);
          await handleIncomingMessage(message(user, user, body).value);
          await handleIncomingMessage(message(user, '120363000000009@g.us', body).value);
        }
        await assertUntouched(product.id);
        assert.equal(getSaleSession(user, group)?.step, 'awaiting_confirmation');
        await handleIncomingMessage(message(user, group, 'confirmar').value);
        assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
      } finally { env.allowPrivateTestMode = false; }
    });
    for (const chatId of [group, user]) await t.test(`another user cannot continue an entry session in ${chatId}`, async () => {
      env.allowPrivateTestMode = true;
      saveEntrySession({ userId: user, chatId, productId: 'not-yet-used', reference: '175/70 R14',
        description: 'Teste', oldCashPrice: 100, oldCreditPrice: 105.8, step: 'awaiting_quantity', updatedAt: Date.now() });
      try {
        await handleIncomingMessage(message(other, chatId === group ? group : other, '3').value);
        assert.equal(getEntrySession(user, chatId)?.step, 'awaiting_quantity');
        await handleIncomingMessage(message(user, chatId, '3').value);
        assert.equal(getEntrySession(user, chatId)?.quantity, 3);
      } finally { clearAllOperationSessions(user, chatId); }
    });
    for (const author of [user, other]) {
      for (const mode of [false, true]) {
        await t.test(`private identity=${author} mode=${mode} requires no individual authorization`, async () => {
          env.allowPrivateTestMode = mode;
          if (mode && author === user) await prisma.user.update({ where: { phone: author }, data: { isActive: false } });
          if (mode && author === other) assert.equal(await prisma.user.findUnique({ where: { phone: author } }), null);
          const product = await prepareSale(author, author);
          try {
            const m = message(author, author, 'confirmar');
            await handleIncomingMessage(m.value);
            if (mode) {
              assert.equal(await prisma.movement.count({ where: { productId: product.id } }), 1);
              assert.equal((await prisma.user.findUniqueOrThrow({ where: { phone: author } })).isActive, author !== user);
            }
            else { await assertUntouched(product.id); assert.deepEqual(m.replies, []); }
          } finally { clearAllOperationSessions(author, author); }
        });
      }
    }
    await t.test('private sessions never equate LID and phone identifiers with matching digits', async () => {
      env.allowPrivateTestMode = true;
      const lid = user.replace('@c.us', '@lid');
      const product = await prepareSale(user, user);
      try {
        await handleIncomingMessage(message(lid, lid, 'confirmar').value);
        await assertUntouched(product.id);
        assert.ok(getSaleSession(user, user));
        const m = message(lid, lid, 'menu');
        await handleIncomingMessage(m.value);
        assert.match(m.replies.join('\n'), /TIREFLOW — MENU/);
        assert.ok(getMenuSession(lid, lid));
        assert.equal(getMenuSession(user, user), null);
      } finally { clearAllOperationSessions(user, user); }
    });
    for (const claimed of [user, false, 0, '']) await t.test(`private author cannot be inconsistent: ${JSON.stringify(claimed)}`, async () => {
      env.allowPrivateTestMode = true;
      const sender = claimed === user ? other : user;
      const product = await prepareSale(user, sender);
      try {
        const m = message(sender, sender, 'confirmar', { author: claimed });
        await handleIncomingMessage(m.value);
        await assertUntouched(product.id);
        assert.deepEqual(m.replies, []);
      } finally { clearAllOperationSessions(user, sender); }
    });
    await t.test('disabling private mode before confirmation denies writing and cancellation', async () => {
      env.allowPrivateTestMode = true;
      const product = await prepareSale(user, user);
      env.allowPrivateTestMode = false; // Models the disabled policy visible to the dispatcher.
      try {
        await handleIncomingMessage(message(user, user, 'confirmar').value);
        await handleIncomingMessage(message(user, user, 'cancelar').value);
        await assertUntouched(product.id);
        assert.ok(getSaleSession(user, user));
      } finally { clearAllOperationSessions(user, user); }
    });
    await t.test('group id discovery reveals only the source group and never operates on another session', async () => {
      const product = await prepareSale();
      try {
        const m = message(other, '120363000000009@g.us', 'grupo id');
        await handleIncomingMessage(m.value);
        assert.deepEqual(m.replies, ['ID deste grupo:\n120363000000009@g.us']);
        await assertUntouched(product.id);
        assert.ok(getSaleSession(user, group));
      } finally { clearAllOperationSessions(user, group); }
    });
    await t.test('denied private messages cannot write users, products, movements or pending sales', async () => {
      env.allowPrivateTestMode = false;
      const product = await prepareSale(user, user);
      const snapshot = () => Promise.all([
        prisma.product.findMany({ orderBy: { id: 'asc' } }), prisma.user.findMany({ orderBy: { id: 'asc' } }),
        prisma.movement.findMany({ orderBy: { id: 'asc' } }), prisma.pendingSale.findMany({ orderBy: { id: 'asc' } }),
      ]);
      const before = await snapshot();
      try {
        for (const body of ['confirmar', 'cancelar', 'entrada 1', 'ajuste 1', 'preco 1', 'cadastrar pneu', 'pendente', 'menu']) {
          const m = message(user, user, body);
          await handleIncomingMessage(m.value);
          assert.deepEqual(m.replies, []);
        }
        await assertUntouched(product.id);
        assert.deepEqual(await snapshot(), before);
        assert.ok(getSaleSession(user, user));
      } finally { clearAllOperationSessions(user, user); }
    });
    await t.test('all operational upsert callers preserve inactive users, including a mentioned pending assignee', async () => {
      const { registerEntry } = await import('../src/services/entryService.js');
      const { registerAdjustment, registerStockTransfer } = await import('../src/services/adjustmentService.js');
      const { registerPriceChange } = await import('../src/services/priceService.js');
      const { registerNewProduct } = await import('../src/services/productRegistrationService.js');
      const { registerPendingSale, returnPendingSaleToStock } = await import('../src/services/pendingSaleService.js');
      for (const phone of [user, other]) await prisma.user.upsert({ where: { phone },
        update: { isActive: false, role: 'USER' }, create: { phone, name: 'Teste', isActive: false } });
      const check = async () => {
        for (const phone of [user, other]) assert.equal((await prisma.user.findUniqueOrThrow({ where: { phone } })).isActive, false);
      };
      const product = await prepareSale();
      clearAllOperationSessions(user, group);
      const responsible = { responsiblePhone: user, responsibleName: 'Teste' };
      await registerEntry({ ...responsible, productId: product.id, quantity: 1, supplier: 'Teste' });
      await check();
      await registerAdjustment({ ...responsible, productId: product.id, newStock: 7, reason: 'Conferência' });
      await check();
      const target = await prisma.product.create({ data: { reference: '185/65 R15', description: 'AUTH TRANSFER', stock: 0,
        cashPrice: 100, creditPrice: 105.8 } });
      await registerStockTransfer({ ...responsible, sourceProductId: product.id, targetProductId: target.id, quantity: 1, reason: 'Conferência' });
      await check();
      await registerPriceChange({ ...responsible, productId: product.id, oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: 120 });
      await check();
      await registerNewProduct({ ...responsible, reference: '195/65 R15', description: 'AUTH NEW', initialStock: 1,
        supplier: 'Teste', cashPrice: 100 });
      await check();
      const pending = await registerPendingSale({ createdByPhone: user, createdByName: 'Teste', assignedPhone: other, assignedName: 'Outro',
        totalValue: 100, items: [{ productId: product.id, reference: product.reference, description: product.description,
          quantity: 1, cashPrice: 120, creditPrice: 126.96, priceType: 'À vista', unitPrice: 100, totalValue: 100 }] });
      await check();
      await returnPendingSaleToStock(pending.id, user, 'Teste');
      await check();
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 6);
    });
  } finally {
    Object.assign(env, previous);
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
