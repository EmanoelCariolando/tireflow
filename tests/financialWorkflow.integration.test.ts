import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Message } from 'whatsapp-web.js';
import type { ClosingSnapshot } from '../src/services/financialService.js';

test('financial commands complete a sale-to-paid-commission-to-refund cycle without a live WhatsApp connection', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-functional-finance-'));
  const database = path.join(root, 'workflow.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/database/prisma.js');
  const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
  const { saveLastQuery } = await import('../src/utils/lastQueryStore.js');
  const { getSaleSession } = await import('../src/utils/saleSessionStore.js');
  const { getFinancialSession } = await import('../src/utils/financialSessionStore.js');
  const admin = '5583000000100@c.us';
  const seller = '5583000000200@lid';
  const group = '120363000000000@g.us';
  let nextMessage = 0;
  const send = async (author: string, body: string) => {
    const replies: string[] = [];
    const id = `synthetic-functional-finance-${++nextMessage}`;
    await handleIncomingMessage({ author, body, from: group, fromMe: false,
      id: { id, _serialized: id, remote: group, fromMe: false },
      getContact: async () => ({ pushname: author === admin ? 'Synthetic Admin' : 'Synthetic Seller' }),
      reply: async (text: string) => { replies.push(text); } } as unknown as Message);
    return replies.join('\n');
  };
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-05T12:00:00-03:00') });
  try {
    await prisma.user.create({ data: { phone: admin, name: 'Synthetic Admin', role: 'ADMIN' } });
    const employee = await prisma.user.create({ data: { phone: seller, name: 'Synthetic Seller' } });
    const a = await prisma.product.create({ data: { reference: '175/70 R14', description: 'SYNTHETIC A',
      stock: 10, cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: 149.99 } });
    const b = await prisma.product.create({ data: { reference: '185/65 R15', description: 'SYNTHETIC B',
      stock: 100, cashPrice: 50, creditPrice: 52.9, tenInstallmentPrice: 88.88 } });
    const query = async (phone: string, productId: string) => {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      saveLastQuery(phone, group, product.reference, [{ id: product.id, reference: product.reference,
        description: product.description, stock: product.stock, cashPrice: Number(product.cashPrice),
        creditPrice: Number(product.creditPrice), tenInstallmentPrice: Number(product.tenInstallmentPrice) }]);
    };
    const price = async (value: string) => {
      await query(admin, a.id);
      await send(admin, 'preço 1');
      await send(admin, value);
      assert.match(await send(admin, 'confirmar'), /PREÇO|PRE[CÇ]O|Preço|preço/);
    };
    const beginSale = async (productId: string, quantity: number, priceOption = '1') => {
      await query(seller, productId);
      await send(seller, `venda 1 ${quantity}`);
      await send(seller, priceOption);
      assert.equal(getSaleSession(seller, group)?.step, 'awaiting_payment');
    };
    const finishSale = async () => {
      await send(seller, 'dinheiro');
      assert.equal(getSaleSession(seller, group)?.step, 'awaiting_confirmation');
      assert.match(await send(seller, 'confirmar'), /VENDA REGISTRADA/);
      assert.equal(getSaleSession(seller, group), null);
    };
    const confirmFinancial = async (command: string) => {
      const preview = await send(admin, command);
      assert.ok(getFinancialSession(admin, group), preview);
      return send(admin, 'confirmar');
    };

    await t.test('price command applies 9.2% once and leaves untouched products unchanged', async () => {
      await price('200');
      assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).tenInstallmentPrice), 218.4);
      await price('200');
      assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).tenInstallmentPrice), 218.4);
      assert.deepEqual(await prisma.product.findUniqueOrThrow({ where: { id: b.id } }), b);
    });
    await t.test('cash sale and discounted sale save 2% and 1% on their final amounts', async () => {
      await beginSale(a.id, 3);
      await finishSale();
      await beginSale(a.id, 1);
      await send(seller, 'desconto');
      await send(seller, '1');
      await send(seller, '10');
      await send(seller, 'confirmar');
      assert.equal(getSaleSession(seller, group)?.totalValue, 180);
      await finishSale();
      const sales = await prisma.movement.findMany({ where: { type: 'SALE' }, orderBy: { code: 'asc' } });
      assert.deepEqual(sales.map(sale => [Number(sale.totalValue), Number(sale.commissionPercent)]), [[600, 2], [180, 1]]);
    });
    await t.test('a 10X session preserves its quote when another user changes the catalog', async () => {
      await beginSale(a.id, 1, '3');
      assert.equal(getSaleSession(seller, group)?.totalValue, 218.4);
      await price('250');
      await finishSale();
      const sale = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE', totalValue: 218.4 } });
      assert.equal(Number(sale.commissionPercent), 2);
      assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).tenInstallmentPrice), 273);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).stock, 5);
    });

    // Only fixture timestamps are aligned with the simulated business clock.
    await prisma.movement.updateMany({ where: { type: 'SALE' }, data: { createdAt: new Date('2026-08-05T12:00:00-03:00') } });
    const originalSales = await prisma.movement.findMany({ where: { type: 'SALE' }, orderBy: { code: 'asc' } });
    t.mock.timers.setTime(new Date('2026-09-02T12:00:00-03:00').getTime());
    await t.test('administrator commands close the month and record commission payment independently', async () => {
      assert.match(await send(seller, 'fechar mes 08/2026'), /administradores ativos/);
      assert.match(await confirmFinancial('fechar mes 08/2026'), /FECHAMENTO REGISTRADO/);
      const closing = await prisma.financialClosing.findUniqueOrThrow({ where: { period: '2026-08' } });
      const snapshot = JSON.parse(closing.snapshotJson) as ClosingSnapshot;
      assert.equal(snapshot.grossRevenue, 99840);
      assert.equal(snapshot.sellers.find(value => value.sellerId === employee.id)!.earned, 1817);
      assert.match(await confirmFinancial('pagar comissao 08/2026 1'), /marcada como paga/);
      const marked = await prisma.financialClosingSeller.findFirstOrThrow({ where: { closingId: closing.id } });
      assert.equal(Number(marked.amount), 18.17);
      assert.ok(marked.paidAt);
      assert.deepEqual(await prisma.financialClosing.findUniqueOrThrow({ where: { id: closing.id } }), closing);
    });
    const first = originalSales[0];
    const discounted = originalSales[1];
    const frozenClosing = await prisma.financialClosing.findUniqueOrThrow({ where: { period: '2026-08' } });
    await t.test('partial, remaining total and delayed physical returns reconcile stock and revenue', async () => {
      assert.match(await send(seller, `estorno ${first.code} total motivo: synthetic`), /administradores ativos/);
      assert.match(await confirmFinancial(`estorno ${first.code} itens 1:1:0 motivo: synthetic partial`), /ESTORNO REGISTRADO/);
      const partial = await prisma.saleReversal.findFirstOrThrow({ orderBy: { code: 'asc' } });
      assert.equal(Number(partial.amount), 200);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).stock, 5);
      await confirmFinancial(`estorno ${first.code} itens 1:2:1 motivo: synthetic remaining`);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).stock, 6);
      const remaining = await prisma.saleReversal.findFirstOrThrow({ orderBy: { code: 'desc' } });
      await confirmFinancial(`retorno estorno ${partial.code} 1 1`);
      await confirmFinancial(`retorno estorno ${remaining.code} 1 1`);
      await confirmFinancial(`estorno ${discounted.code} total motivo: synthetic total`);
      const total = await prisma.saleReversal.findFirstOrThrow({ orderBy: { code: 'desc' } });
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).stock, 8);
      await confirmFinancial(`retorno estorno ${total.code} 1 1`);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).stock, 9);
      assert.match(await send(admin, `estorno ${first.code} total motivo: duplicate`), /quantidade disponível/);
      assert.deepEqual(await prisma.movement.findMany({ where: { id: { in: originalSales.map(sale => sale.id) } }, orderBy: { code: 'asc' } }), originalSales);
      assert.deepEqual(await prisma.financialClosing.findUniqueOrThrow({ where: { id: frozenClosing.id } }), frozenClosing);
    });
    await t.test('next closing applies paid commission adjustments once against new commission', async () => {
      await beginSale(b.id, 20);
      await finishSale();
      await prisma.movement.updateMany({ where: { type: 'SALE', productId: b.id }, data: { createdAt: new Date('2026-09-02T12:00:00-03:00') } });
      t.mock.timers.setTime(new Date('2026-10-02T12:00:00-03:00').getTime());
      await confirmFinancial('fechar mes 09/2026');
      const september = await prisma.financialClosing.findUniqueOrThrow({ where: { period: '2026-09' } });
      const snapshot = JSON.parse(september.snapshotJson) as ClosingSnapshot;
      assert.equal(snapshot.grossRevenue, 100000);
      assert.equal(snapshot.refunds, 78000);
      assert.equal(snapshot.netRevenue, 22000);
      const earned = snapshot.sellers.find(value => value.sellerId === employee.id)!;
      assert.deepEqual([earned.earned, earned.adjustments, earned.net], [2000, -1380, 620]);
      await confirmFinancial('pagar comissao 09/2026 1');
      const paid = await prisma.financialClosingSeller.findFirstOrThrow({ where: { closingId: september.id } });
      assert.equal(Number(paid.amount), 6.2);
      assert.ok(paid.paidAt);
      await confirmFinancial('fechar mes 09/2026');
      assert.equal(await prisma.financialClosing.count({ where: { period: '2026-09' } }), 1);
      t.mock.timers.setTime(new Date('2026-11-02T12:00:00-03:00').getTime());
      await confirmFinancial('fechar mes 10/2026');
      const october = await prisma.financialClosing.findUniqueOrThrow({ where: { period: '2026-10' } });
      assert.deepEqual((JSON.parse(october.snapshotJson) as ClosingSnapshot).adjustments, []);
      assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).tenInstallmentPrice), 88.88);
      assert.deepEqual(await prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
    });
  } finally {
    t.mock.timers.reset();
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
