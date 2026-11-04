import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Message } from 'whatsapp-web.js';
import type { ClosingSnapshot } from '../src/services/financialService.js';

test('financial reversals, physical returns and immutable commission closings use an isolated ledger', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-reversals-'));
  const database = path.join(root, 'test.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/database/prisma.js');
  const financial = await import('../src/services/financialService.js');
  const { handleFinancialCommand, handleFinancialConversation } = await import('../src/commands/financialCommand.js');
  const { getFinancialSession, clearFinancialSession } = await import('../src/utils/financialSessionStore.js');
  const { hasActiveOperationSession, clearAllOperationSessions } = await import('../src/utils/operationSessionCoordinator.js');
  const { buildTodayReport } = await import('../src/services/reportService.js');
  const { buildMonthlyReport, buildCommissionReportForPeriod } = await import('../src/services/monthlyReportService.js');
  const { getFinancialPeriod } = await import('../src/utils/financialPeriod.js');
  const { findFinancialRefunds } = await import('../src/repositories/financialLedgerRepository.js');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-02T12:00:00-03:00') });
  const adminPhone = '5583000000001@c.us';
  const admin = await prisma.user.create({ data: { name: 'Synthetic Admin', phone: adminPhone, role: 'ADMIN' } });
  const seller = await prisma.user.create({ data: { name: 'Synthetic Seller', phone: '5583000000002@lid' } });
  const inactive = await prisma.user.create({ data: { name: 'Inactive', phone: '5583000000003@c.us', role: 'ADMIN', isActive: false } });
  let sequence = 0;
  const seedSale = async (amount = 100, quantity = 3, commissionPercent = 2, extra = {}) => {
    const product = await prisma.product.create({ data: { reference: '175/70 R14', description: `SYNTHETIC ${++sequence}`,
      stock: 5, cashPrice: 200, creditPrice: 211.60, tenInstallmentPrice: 218.40 } });
    const sale = await prisma.movement.create({ data: { code: `#V-${String(sequence).padStart(6, '0')}`, type: 'SALE',
      saleGroupCode: `#V-${String(sequence).padStart(6, '0')}`, productId: product.id, userId: seller.id,
      quantity, previousStock: 5 + quantity, newStock: 5, totalValue: amount, unitPrice: amount / quantity,
      paymentMethod: 'Dinheiro', commissionPercent,
      createdAt: sequence === 1 ? new Date('2026-08-10T12:00:00-03:00') : new Date(), ...extra } });
    return { product, sale };
  };
  const close = async (period: string) => {
    const preview = await financial.previewFinancialClosing(adminPhone, period);
    return financial.closeFinancialMonth(adminPhone, period, preview.hash);
  };
  const request = (saleCode: string, operationId: string, quantity = 1, returnedQuantity = 0) => ({
    actorPhone: adminPhone, operationId, saleCode, reason: 'Synthetic return',
    selections: [{ position: 1, quantity, returnedQuantity }],
  });
  const main = await seedSale();
  const original = await prisma.movement.findUniqueOrThrow({ where: { id: main.sale.id } });
  try {
    await t.test('authorization fails closed for unknown, ordinary and inactive users', async () => {
      for (const actorPhone of ['unknown@c.us', seller.phone, inactive.phone]) {
        await assert.rejects(financial.previewSaleReversal({ ...request(main.sale.code, 'denied'), actorPhone }), /administradores ativos/);
        await assert.rejects(financial.registerSaleReversal({ ...request(main.sale.code, 'denied'), actorPhone }), /administradores ativos/);
        await assert.rejects(financial.previewFinancialClosing(actorPhone, '2026-08'), /administradores ativos/);
        await assert.rejects(financial.closeFinancialMonth(actorPhone, '2026-08', ''), /administradores ativos/);
        await assert.rejects(financial.markClosingCommissionPaid(actorPhone, '2026-08', 1), /administradores ativos/);
        await assert.rejects(financial.registerReversalReturn({ actorPhone, operationId: 'denied', reversalCode: '#E-000001', position: 1, quantity: 1 }), /administradores ativos/);
      }
      assert.equal(await prisma.saleReversal.count(), 0);
    });

    let august: Awaited<ReturnType<typeof close>>;
    await t.test('an explicit closing freezes amounts and payment marking is separate and idempotent', async () => {
      await assert.rejects(financial.previewFinancialClosing(adminPhone, '2026-09'), /em andamento/);
      await assert.rejects(financial.closeFinancialMonth(adminPhone, '2026-08', 'stale'), /valores mudaram/);
      august = await close('2026-08');
      assert.equal((JSON.parse(august.snapshotJson) as ClosingSnapshot).sellers[0].net, 200);
      assert.equal((await close('2026-08')).id, august.id);
      const paid = await financial.markClosingCommissionPaid(adminPhone, '2026-08', 1);
      assert.equal(paid.paidById, admin.id);
      assert.equal(Number(paid.amount), 2);
      assert.ok(paid.paidAt);
      assert.deepEqual(await financial.markClosingCommissionPaid(adminPhone, '2026-08', 1), paid);
    });

    let firstReversal: Awaited<ReturnType<typeof financial.registerSaleReversal>>;
    await t.test('partial reversal preserves original sale, historical prices, paid closing and stock', async () => {
      const payload = request(main.sale.code, 'first');
      const preview = await financial.previewSaleReversal(payload);
      assert.equal(preview.amount, 33.33, 'Use the original 100 total, never the current 200 catalog price.');
      const results = await Promise.all([financial.registerSaleReversal(payload), financial.registerSaleReversal(payload)]);
      firstReversal = results[0];
      assert.equal(results[0].id, results[1].id);
      assert.equal(Number(firstReversal.amount), 33.33);
      await assert.rejects(financial.registerSaleReversal({ ...payload, reason: 'changed' }), /outros dados/);
      assert.deepEqual(await prisma.movement.findUniqueOrThrow({ where: { id: main.sale.id } }), original);
      assert.deepEqual(await prisma.product.findUniqueOrThrow({ where: { id: main.product.id } }), main.product);
      assert.deepEqual(await prisma.financialClosing.findUniqueOrThrow({ where: { period: '2026-08' } }), august!);
      assert.equal((await buildMonthlyReport(new Date('2026-09-02T12:00:00-03:00')))[0], august!.financialText);
      assert.equal(await buildCommissionReportForPeriod(getFinancialPeriod('2026-08')), august!.commissionText);
      const utc = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
        env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8', timeout: 20000,
        input: `const { buildMonthlyReport, buildCommissionReportForPeriod, getCommissionPeriod } = await import('./src/services/monthlyReportService.ts');
          const { prisma } = await import('./src/database/prisma.ts');
          try { const date = new Date('2026-09-15T12:00:00Z');
            console.log(JSON.stringify({ financial: await buildMonthlyReport(date),
              commission: await buildCommissionReportForPeriod(getCommissionPeriod(date)) })); }
          finally { await prisma.$disconnect(); }`,
      });
      assert.equal(utc.status, 0, utc.stderr);
      const texts = JSON.parse(utc.stdout.trim().split('\n').at(-1)!);
      assert.deepEqual(texts.financial, [august!.financialText]);
      assert.equal(texts.commission, august!.commissionText);
    });

    await t.test('remaining reversal conserves cents and only physically returned items increase stock', async () => {
      await assert.rejects(financial.registerSaleReversal(request(main.sale.code, 'too-many', 3)), /ultrapassa/);
      await assert.rejects(financial.registerSaleReversal(request(main.sale.code, 'invalid', 1, 2)), /inválida/);
      await assert.rejects(financial.registerSaleReversal({ ...request(main.sale.code, 'duplicate'),
        selections: [{ position: 1, quantity: 1, returnedQuantity: 0 }, { position: 1, quantity: 1, returnedQuantity: 0 }] }), /distintos/);
      const remaining = await financial.registerSaleReversal(request(main.sale.code, 'remaining', 2, 1));
      assert.equal(Number(remaining.amount), 66.67);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: main.product.id } })).stock, 6);
      await assert.rejects(financial.registerSaleReversal(request(main.sale.code, 'overdrawn')), /ultrapassa/);
      assert.equal(await prisma.saleReversal.count(), 2);
      assert.equal(await prisma.commissionAdjustment.count(), 2);
    });

    await t.test('delayed physical returns have their own idempotency without a second refund', async () => {
      const payload = { operationId: 'delayed-return', actorPhone: adminPhone, reversalCode: firstReversal!.code, position: 1, quantity: 1 };
      const receipts = await Promise.all([financial.registerReversalReturn(payload), financial.registerReversalReturn(payload)]);
      assert.equal(receipts[0].id, receipts[1].id);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: main.product.id } })).stock, 7);
      await assert.rejects(financial.registerReversalReturn({ ...payload, quantity: 2 }), /outros dados/);
      await assert.rejects(financial.registerReversalReturn({ ...payload, operationId: 'overflow' }), /ultrapassa/);
      assert.equal(await prisma.saleReversal.count(), 2);
      assert.equal(await prisma.commissionAdjustment.count(), 2);
      assert.equal((await financial.readSaleReversal(adminPhone, firstReversal!.code)).items[0].returns.length, 1);
    });

    await t.test('refunds are booked in the current month while the original closing stays unchanged', async () => {
      const refunds = await findFinancialRefunds(getFinancialPeriod('2026-09').start, getFinancialPeriod('2026-09').end);
      assert.equal(refunds.total, 100);
      assert.equal(refunds.paymentTotals.Dinheiro, 100);
      const report = await buildTodayReport(new Date());
      assert.match(report, /FATURAMENTO: R\$-100,00/);
      assert.equal((JSON.parse(august!.snapshotJson) as ClosingSnapshot).netRevenue, 10000);
      assert.deepEqual(await prisma.movement.findUniqueOrThrow({ where: { id: main.sale.id } }), original);
    });

    await t.test('paid commissions debit the next closing exactly once, never an earlier closing', async () => {
      t.mock.timers.setTime(new Date('2026-10-02T12:00:00-03:00').getTime());
      const september = await close('2026-09');
      const snapshot = JSON.parse(september.snapshotJson) as ClosingSnapshot;
      assert.equal(snapshot.refunds, 10000);
      assert.equal(snapshot.netRevenue, -10000);
      assert.equal(snapshot.sellers[0].adjustments, -200);
      assert.equal(snapshot.sellers[0].net, -200);
      assert.equal((await prisma.commissionAdjustment.findMany()).reduce((sum, adjustment) => sum + Number(adjustment.amount), 0), -2);
      await assert.rejects(financial.markClosingCommissionPaid(adminPhone, '2026-09', 1), /positiva/);
      assert.equal((await close('2026-09')).id, september.id);
      assert.deepEqual(await prisma.financialClosing.findUniqueOrThrow({ where: { id: august!.id } }), august!);
      t.mock.timers.setTime(new Date('2026-11-02T12:00:00-03:00').getTime());
      assert.deepEqual((JSON.parse((await close('2026-10')).snapshotJson) as ClosingSnapshot).adjustments, []);
    });

    await t.test('mixed payment partial refunds conserve each original payment and cumulative cents', async () => {
      const mixed = await seedSale(0.07, 7, 1, { paymentMethod: 'Misto', paymentDetails: JSON.stringify([
        { method: 'Dinheiro', amount: 0.03 }, { method: 'PIX', amount: 0.04 }]) });
      for (let i = 0; i < 7; i++) await financial.registerSaleReversal(request(mixed.sale.code, `mixed-${i}`));
      const refunds = await prisma.saleReversalItem.findMany({ where: { movementId: mixed.sale.id } });
      const parts = refunds.flatMap(item => JSON.parse(item.paymentDetails) as Array<{ method: string; amount: number }>);
      assert.ok(parts.every(part => part.amount >= 0));
      assert.equal(parts.filter(part => part.method === 'Dinheiro').reduce((sum, part) => sum + Math.round(part.amount * 100), 0), 3);
      assert.equal(parts.filter(part => part.method === 'PIX').reduce((sum, part) => sum + Math.round(part.amount * 100), 0), 4);
      assert.equal(refunds.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0), 7);
    });

    await t.test('transaction rolls back the entire financial refund when a physical return fails', async () => {
      const bad = await seedSale();
      await prisma.product.update({ where: { id: bad.product.id }, data: { stock: 2147483647 } });
      const before = await prisma.saleReversal.count();
      await assert.rejects(financial.registerSaleReversal(request(bad.sale.code, 'rollback', 1, 1)), /limite/);
      assert.equal(await prisma.saleReversal.count(), before);
      assert.equal(await prisma.saleReversalItem.count({ where: { movementId: bad.sale.id } }), 0);
      assert.deepEqual(await prisma.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
    });

    await t.test('commands isolate chats, support cancellation and recheck revoked admin at confirmation', async () => {
      const candidate = await seedSale();
      let id = 0;
      const replies: string[] = [];
      const message = (chat = '120363000000000@g.us', phone = adminPhone) => ({ author: phone, from: chat,
        id: { _serialized: `synthetic-financial-${++id}` }, reply: async (text: string) => { replies.push(text); } }) as unknown as Message;
      const group = message();
      await handleFinancialCommand(message(undefined, seller.phone), 'financeiro');
      assert.match(replies.at(-1)!, /administradores ativos/);
      await handleFinancialCommand(group, `estorno ${candidate.sale.code} total motivo: synthetic`);
      assert.ok(hasActiveOperationSession(adminPhone, group.from));
      assert.equal(await handleFinancialConversation(message('120363000000099@g.us'), 'confirmar'), false);
      await handleFinancialConversation(group, 'cancelar');
      assert.equal(getFinancialSession(adminPhone, group.from), null);
      await handleFinancialCommand(message(), `estorno ${candidate.sale.code} total motivo: synthetic`);
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'USER' } });
      await handleFinancialConversation(group, 'confirmar');
      assert.match(replies.at(-1)!, /administradores ativos/);
      assert.equal(await prisma.saleReversalItem.count({ where: { movementId: candidate.sale.id } }), 0);
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
      await handleFinancialCommand(message(), `estorno ${candidate.sale.code} itens 1:1:0 motivo: synthetic`);
      clearAllOperationSessions(adminPhone, group.from);
      assert.equal(await handleFinancialConversation(group, 'confirmar'), false);
      await handleFinancialCommand(message(), `estorno ${candidate.sale.code} itens 1:1:0 motivo: synthetic`);
      const failing = { ...group, reply: async () => { throw new Error('Synthetic reply failed'); } } as unknown as Message;
      await handleFinancialConversation(failing, 'confirmar');
      assert.equal(getFinancialSession(adminPhone, group.from), null);
      assert.equal(await prisma.saleReversalItem.count({ where: { movementId: candidate.sale.id } }), 1);
      assert.equal(await handleFinancialConversation(group, 'confirmar'), false);
      clearFinancialSession(adminPhone, group.from);
    });

    await t.test('partial selection keeps the original item number for immediate and delayed returns', async () => {
      const a = await seedSale();
      const b = await seedSale();
      await prisma.movement.update({ where: { id: b.sale.id }, data: { saleGroupCode: a.sale.saleGroupCode } });
      const reversal = await financial.registerSaleReversal({ ...request(a.sale.code, 'item-two', 2, 1),
        selections: [{ position: 2, quantity: 2, returnedQuantity: 1 }] });
      const item = (await financial.readSaleReversal(adminPhone, reversal.code)).items[0];
      assert.equal(item.position, 2);
      assert.equal(item.movementId, b.sale.id);
      const replies: string[] = [];
      const message = { author: adminPhone, from: '120363000000000@g.us', id: { _serialized: 'synthetic-item-two' },
        reply: async (text: string) => { replies.push(text); } } as unknown as Message;
      await handleFinancialCommand(message, `retorno estorno ${reversal.code} 2 1`);
      assert.match(replies.at(-1)!, /Digite \*confirmar\*/);
      await handleFinancialConversation(message, 'confirmar');
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: a.product.id } })).stock, 5);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } })).stock, 7);
      await assert.rejects(financial.registerReversalReturn({ actorPhone: adminPhone, operationId: 'wrong-position',
        reversalCode: reversal.code, position: 1, quantity: 1 }), /ultrapassa/);
    });

    await t.test('an ambiguous commit retains the same key and retry returns the recorded reversal', async () => {
      const candidate = await seedSale();
      const message = { author: adminPhone, from: '120363000000000@g.us', id: { _serialized: 'synthetic-ambiguous' },
        reply: async () => {} } as unknown as Message;
      await handleFinancialCommand(message, `estorno ${candidate.sale.code} total motivo: synthetic`);
      const originalTransaction = prisma.$transaction;
      prisma.$transaction = (async (...args: unknown[]) => {
        await (originalTransaction as (...values: unknown[]) => Promise<unknown>).apply(prisma, args);
        throw new Error('Synthetic transport failure after COMMIT');
      }) as typeof prisma.$transaction;
      try {
        await handleFinancialConversation(message, 'confirmar');
      } finally {
        prisma.$transaction = originalTransaction;
      }
      assert.ok(getFinancialSession(adminPhone, message.from));
      await handleFinancialConversation(message, 'confirmar');
      assert.equal(getFinancialSession(adminPhone, message.from), null);
      assert.equal(await prisma.saleReversalItem.count({ where: { movementId: candidate.sale.id } }), 1);
    });

    await t.test('the WhatsApp router accepts an active ADMIN @lid and denies ordinary senders and other groups', async () => {
      const { handleIncomingMessage } = await import('../src/whatsapp/messageHandler.js');
      const lid = await prisma.user.create({ data: { name: 'Synthetic LID Admin', phone: '5583000000099@lid', role: 'ADMIN' } });
      const candidate = await seedSale();
      let sequence = 0;
      const send = async (author: string, body: string, from = '120363000000000@g.us') => {
        const replies: string[] = [];
        const id = `synthetic-ledger-router-${++sequence}`;
        await handleIncomingMessage({ author, body, from, fromMe: false,
          id: { id, _serialized: id, remote: from, fromMe: false },
          reply: async (text: string) => { replies.push(text); } } as unknown as Message);
        return replies;
      };
      assert.match((await send(seller.phone, `estorno ${candidate.sale.code} total motivo: synthetic`)).join('\n'), /administradores ativos/);
      assert.deepEqual(await send(lid.phone, 'financeiro', '120363000000099@g.us'), []);
      assert.match((await send(lid.phone, `estorno ${candidate.sale.code} itens 1:1:0 motivo: synthetic`)).join('\n'), /ESTORNO — CONFIRMAR/);
      assert.match((await send(lid.phone, 'confirmar')).join('\n'), /ESTORNO REGISTRADO/);
      assert.equal(await prisma.saleReversalItem.count({ where: { movementId: candidate.sale.id } }), 1);
    });

    await t.test('stale closing and refund previews are checked inside the write transaction', async () => {
      const candidate = await seedSale();
      const preview = await financial.previewSaleReversal(request(candidate.sale.code, 'stale-refund', 1));
      await financial.registerSaleReversal(request(candidate.sale.code, 'earlier-refund', 1));
      // After 33.33 is refunded the next proportional unit is 33.34.
      await assert.rejects(financial.registerSaleReversal({ ...request(candidate.sale.code, 'stale-refund', 1),
        expectedAmounts: preview.expectedAmounts }), /saldo mudou/);
      const closingPreview = await financial.previewFinancialClosing(adminPhone, '2026-10');
      // October was already closed above: it returns its immutable receipt despite new records.
      assert.equal((await financial.closeFinancialMonth(adminPhone, '2026-10', closingPreview.hash)).period, '2026-10');
      const futureSale = await seedSale(10, 1, 2, { createdAt: new Date('2026-11-01T12:00:00-03:00') });
      t.mock.timers.setTime(new Date('2026-12-02T12:00:00-03:00').getTime());
      const november = await financial.previewFinancialClosing(adminPhone, '2026-11');
      await financial.registerSaleReversal(request(futureSale.sale.code, 'new-refund'));
      await assert.rejects(financial.closeFinancialMonth(adminPhone, '2026-11', november.hash), /valores mudaram/);
    });

    await t.test('an unclosed original month establishes the commission basis before a later closing', async () => {
      const candidate = await seedSale(100, 1, 2, { createdAt: new Date('2026-11-15T12:00:00-03:00') });
      const reversal = await financial.registerSaleReversal(request(candidate.sale.code, 'unclosed-origin'));
      t.mock.timers.setTime(new Date('2027-01-02T12:00:00-03:00').getTime());
      await assert.rejects(financial.previewFinancialClosing(adminPhone, '2026-12'), /Feche primeiro o mês de origem 2026-11/);
      const origin = await close('2026-11');
      const basis = (JSON.parse(origin.snapshotJson) as ClosingSnapshot).lines.find(line => line.movementId === candidate.sale.id)!;
      assert.equal(basis.commission, 200);
      const adjustment = await prisma.commissionAdjustment.findFirstOrThrow({ where: { reversalItem: { reversalId: reversal.id } } });
      assert.equal(adjustment.closingId, origin.id);
      assert.equal(Number(adjustment.amount), -2);
      const next = await close('2026-12');
      assert.ok(!(JSON.parse(next.snapshotJson) as ClosingSnapshot).adjustments.some(item => item.id === adjustment.id));
      assert.ok((JSON.parse(next.snapshotJson) as ClosingSnapshot).refunds >= 10000);
    });
  } finally {
    t.mock.timers.reset();
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});

test('mixed commission rates round once per seller and refunds never recover more than the frozen commission', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-closing-cents-'));
  const database = path.join(root, 'test.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  // The shared Prisma client has already connected in the first test; use its isolated database after disconnect.
  const { prisma } = await import('../src/database/prisma.js');
  const financial = await import('../src/services/financialService.js');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-02-02T12:00:00-03:00') });
  try {
    const admin = await prisma.user.create({ data: { name: 'Rounding Admin', phone: 'rounding-admin', role: 'ADMIN' } });
    const seller = await prisma.user.create({ data: { name: 'Rounding Seller', phone: 'rounding-seller' } });
    const product = await prisma.product.create({ data: { reference: 'SYNTHETIC', description: 'CENTS', stock: 0, cashPrice: 1, creditPrice: 1 } });
    const sales = [];
    for (const [index, amount, rate] of [[1, 0.25, 2], [2, 0.50, 1]]) {
      sales.push(await prisma.movement.create({ data: { type: 'SALE', code: `#V-ROUND-${index}`, productId: product.id,
        userId: seller.id, totalValue: amount, quantity: 1, commissionPercent: rate, paymentMethod: 'PIX', createdAt: new Date('2027-01-10T12:00:00-03:00') } }));
    }
    const preview = await financial.previewFinancialClosing(admin.phone, '2027-01');
    const closing = await financial.closeFinancialMonth(admin.phone, '2027-01', preview.hash);
    const snapshot = JSON.parse(closing.snapshotJson) as ClosingSnapshot;
    assert.equal(snapshot.sellers.find(value => value.sellerId === seller.id)!.earned, 1);
    for (const sale of sales) await financial.registerSaleReversal({ actorPhone: admin.phone, operationId: sale.id,
      saleCode: sale.code, reason: 'Synthetic', selections: 'all' });
    t.mock.timers.setTime(new Date('2027-03-02T12:00:00-03:00').getTime());
    const next = await financial.previewFinancialClosing(admin.phone, '2027-02');
    assert.equal(next.snapshot.sellers.find(value => value.sellerId === seller.id)!.adjustments, -1);
  } finally {
    t.mock.timers.reset();
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
