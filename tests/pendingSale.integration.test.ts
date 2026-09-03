import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('keeps pending stock atomic until sale or return', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-pending-'));
  const databasePath = path.join(temporaryRoot, 'pending.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  await writeFile(databasePath, '');
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  process.env.DATABASE_URL = databaseUrl;

  const { prisma } = await import('../src/database/prisma.js');
  const {
    findOpenPendingSales,
    registerPendingSale,
    returnPendingSaleToStock,
  } = await import('../src/services/pendingSaleService.js');
  const { registerSaleItems } = await import('../src/services/saleService.js');
  const { formatPendingReminder, formatPendingSaleList } =
    await import('../src/commands/pendingSaleFormatting.js');

  try {
    const product = await prisma.product.create({
      data: {
        reference: '175/70 R13', description: 'SPM MH01', stock: 3,
        minStock: 0, cashPrice: 300, creditPrice: 320,
      },
    });
    const pending = await registerPendingSale({
      items: [{
        productId: product.id, reference: product.reference, description: product.description,
        quantity: 1, cashPrice: 300, creditPrice: 320, priceType: 'À vista',
        unitPrice: 300, totalValue: 300,
      }],
      createdByPhone: 'creator@c.us', createdByName: 'Distribuidor',
      assignedPhone: 'employee@c.us', assignedName: 'Fulano', totalValue: 300,
    });

    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 0);
    assert.equal((await findOpenPendingSales()).length, 1);
    assert.match(formatPendingSaleList([pending]), /Fulano/);
    assert.match(formatPendingReminder([pending]), /digite: \*pendente\*/);

    await registerSaleItems({
      items: [{ productId: product.id, quantity: 1, unitPrice: 300, totalValue: 300 }],
      sellerPhone: pending.assignedTo.phone,
      sellerName: pending.assignedTo.name,
      totalValue: 300,
      paymentMethod: 'PIX',
      pendingSaleId: pending.id,
    });
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 1);
    assert.equal((await prisma.pendingSale.findUniqueOrThrow({ where: { id: pending.id } })).status, 'SOLD');

    const returnedPending = await registerPendingSale({
      items: [{
        productId: product.id, reference: product.reference, description: product.description,
        quantity: 1, cashPrice: 300, creditPrice: 320, priceType: 'À vista',
        unitPrice: 300, totalValue: 300,
      }],
      createdByPhone: 'creator@c.us', createdByName: 'Distribuidor',
      assignedPhone: 'employee@c.us', assignedName: 'Fulano', totalValue: 300,
    });
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 1);

    await returnPendingSaleToStock(returnedPending.id, 'resolver@c.us', 'Responsável');
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);
    assert.equal(
      (await prisma.pendingSale.findUniqueOrThrow({ where: { id: returnedPending.id } })).status,
      'RETURNED'
    );
    assert.equal(await prisma.movement.count({ where: { type: 'ADJUSTMENT' } }), 1);
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
