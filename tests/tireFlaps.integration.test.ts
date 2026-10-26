import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';

test('imports and operates the approved protector catalog on disposable SQLite', { timeout: 60000 }, async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tireflow-flaps-'));
  const database = path.join(root, 'flaps.sqlite');
  await fs.writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { getLastQuery } = await import('../src/utils/lastQueryStore.js');
  const { getSaleSession } = await import('../src/utils/saleSessionStore.js');
  const { clearAllOperationSessions } = await import('../src/utils/operationSessionCoordinator.js');
  const { acquireDatabaseMaintenanceLock } = await import('../src/database/maintenanceLock.js');
  let sequence = 0;
  const user = '5583000000191@lid', other = '5583000000192@c.us';
  const chat = env.whatsappOfficialGroupId;
  const send = async (body: string, author = user) => {
    const replies: string[] = [];
    const id = `flap-${++sequence}`;
    await handleIncomingMessage({ author, from: chat, fromMe: false, body, type: 'chat', hasMedia: false,
      id: { id, _serialized: id, remote: chat, fromMe: false }, getContact: async () => ({ pushname: 'Teste' }),
      reply: async (text: string) => { replies.push(text); },
    } as unknown as Message);
    return replies.join('\n');
  };
  const load = (apply = false, branch = 'CONGO') => spawnSync(process.execPath,
    ['--import', 'tsx', 'src/database/importTireFlaps.ts', ...(apply ? ['--apply'] : [])],
    { encoding: 'utf8', timeout: 15000, env: { ...process.env, BRANCH_NAME: `ATC PNEUS ${branch} TESTE` } });
  try {
    await t.test('dry run writes nothing; apply imports only six priced models and 35 units', async () => {
      let result = load(); assert.equal(result.status, 0, result.stderr);
      assert.equal(await prisma.product.count(), 0);
      result = load(true); assert.equal(result.status, 0, result.stderr);
      const products = await prisma.product.findMany({ orderBy: { reference: 'asc' } });
      assert.deepEqual(products.map(p => [p.description, Number(p.cashPrice), Number(p.creditPrice), p.stock]), [
        ['PROTETOR 16', 49, 51.84, 16], ['PROTETOR 20', 69, 73, 5], ['PROTETOR 22', 79, 83.58, 11],
        ['PROTETOR 24', 149, 157.64, 1], ['PROTETOR 25', 189, 199.96, 1], ['PROTETOR 30 ABC', 199, 210.54, 1],
      ]);
      assert.ok(products.every(p => String(p.category) === 'TIRE_FLAP'));
    });
    await t.test('search, typo help and zero stock invalidate old selections and isolate users', async () => {
      assert.match(await send('protetor'), /PROTETORES[\s\S]*PROTETOR 16/);
      assert.equal(getLastQuery(user, chat)?.products.length, 6);
      assert.match(await send('protetor', other), /PROTETORES/);
      assert.match(await send('protetro'), /COMO PESQUISAR PROTETORES[\s\S]*\*protetor\*/);
      assert.equal(getLastQuery(user, chat), null);
      assert.equal(getLastQuery(other, chat)?.products.length, 6);
      await send('protetor');
      assert.match(await send('0 protetor'), /Nenhum protetor.*zerado/);
      assert.equal(getLastQuery(user, chat), null);
      await send('venda 1 1'); assert.equal(getSaleSession(user, chat), null);
    });
    await t.test('a legitimate indexed sale keeps stock, money and the approved 1 percent commission', async () => {
      await send('protetor');
      assert.match(await send('1'), /PROTETOR 16/);
      await send('1'); // Sell.
      assert.match(await send('1'), /PREÇO|vista/i); // Quantity.
      await send('1'); // Cash price.
      await send('1'); // Cash payment.
      assert.match(await send('confirmar'), /VENDA REGISTRADA/);
      const sale = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE' }, include: { product: true } });
      assert.equal(sale.product.stock, 15);
      assert.equal(Number(sale.totalValue), 49);
      assert.equal(Number(sale.commissionPercent), 1);
      const before = await prisma.product.findMany({ orderBy: { id: 'asc' } });
      const result = load(true); assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(await prisma.product.findMany({ orderBy: { id: 'asc' } }), before);
      assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 1);
    });
    await t.test('unavailable and failed searches cannot leave an old selection', async () => {
      const product = await prisma.product.findFirstOrThrow({ where: { description: 'PROTETOR 24' } });
      await prisma.product.update({ where: { id: product.id }, data: { stock: 0 } });
      assert.match(await send('0 protetor'), /PROTETOR 24/);
      await send('protetor');
      const originalQuery = prisma.product.findMany;
      prisma.product.findMany = () => { throw new Error('controlled lookup failure'); };
      try { assert.match(await send('protetor'), /Erro na consulta.*protetores/i); }
      finally { prisma.product.findMany = originalQuery; }
      assert.equal(getLastQuery(user, chat), null);
    });
    await t.test('apply refuses another writer and any other branch', async () => {
      const release = await acquireDatabaseMaintenanceLock(database);
      try { const result = load(true); assert.equal(result.status, 1); assert.match(result.stderr, /bloque|uso|ativo/); }
      finally { await release(); }
      assert.equal(load(true, 'MONTEIRO').status, 1);
    });
    await t.test('invalid CSV and conflicting identities do not change existing products', async () => {
      const csv = 'data/seed/congo_tire_flaps_2026-10-15.csv';
      const content = await fs.readFile(csv, 'utf8');
      const before = await prisma.product.findMany({ orderBy: { id: 'asc' } });
      try {
        for (const invalid of [content.replace('49.00', '-1.00'), content.replace('51.84,16,', '51.84,2147483648,'),
          content + content.split('\n')[1] + '\n']) {
          await fs.writeFile(csv, invalid);
          assert.equal(load(true).status, 1);
          assert.deepEqual(await prisma.product.findMany({ orderBy: { id: 'asc' } }), before);
          await assert.rejects(fs.stat(`${database}.tireflow-lock`), { code: 'ENOENT' });
        }
      } finally { await fs.writeFile(csv, content); }
      const conflict = await prisma.product.create({ data: { reference: 'CONFLICT', description: 'PROTETOR 16',
        cashPrice: 100, creditPrice: 105.8, stock: 1 } });
      try { const result = load(true); assert.equal(result.status, 1); assert.match(result.stderr, /conflitante/); }
      finally { await prisma.product.delete({ where: { id: conflict.id } }); }
      assert.deepEqual(await prisma.product.findMany({ orderBy: { id: 'asc' } }), before);
    });
  } finally {
    clearAllOperationSessions(user, chat); clearAllOperationSessions(other, chat);
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
