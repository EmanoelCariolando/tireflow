import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('keeps sale, stock movements and prices atomic on a migrated SQLite database', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-operations-'));
  const databasePath = path.join(temporaryRoot, 'operations.db');
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
  const { registerSale, InsufficientStockError } = await import('../src/services/saleService.js');
  const { registerEntry } = await import('../src/services/entryService.js');
  const { registerAdjustment } = await import('../src/services/adjustmentService.js');
  const { registerPriceChange } = await import('../src/services/priceService.js');
  const { findAvailableProductsByReference } = await import('../src/services/productService.js');
  const { runPostCommitTask } = await import('../src/services/postCommitTask.js');

  try {
    const product = await prisma.product.create({
      data: {
        reference: '175/70/14', description: 'PNEU TESTE', stock: 3,
        minStock: 1, cashPrice: 100, creditPrice: 110,
      },
    });
    const saleInput = (sellerPhone: string) => ({
      productId: product.id, sellerPhone, sellerName: sellerPhone, quantity: 2,
      unitPrice: 100, totalValue: 200, paymentMethod: 'Dinheiro' as const,
    });
    const concurrentSales = await Promise.allSettled([
      registerSale(saleInput('seller-a')),
      registerSale(saleInput('seller-b')),
    ]);
    assert.equal(concurrentSales.filter((result) => result.status === 'fulfilled').length, 1);
    const rejectedSale = concurrentSales.find((result) => result.status === 'rejected');
    assert.ok(rejectedSale?.status === 'rejected' && rejectedSale.reason instanceof InsufficientStockError);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 1);
    assert.equal(await prisma.movement.count({ where: { type: 'SALE' } }), 1);

    const entry = await registerEntry({
      productId: product.id, responsiblePhone: 'entry-user', responsibleName: 'Entry User',
      quantity: 4, supplier: 'Fornecedor',
    });
    assert.deepEqual({ previous: entry.previousStock, current: entry.currentStock }, { previous: 1, current: 5 });

    const adjustment = await registerAdjustment({
      productId: product.id, responsiblePhone: 'adjust-user', responsibleName: 'Adjust User',
      newStock: 2, reason: 'Conferência',
    });
    assert.deepEqual(
      { previous: adjustment.previousStock, current: adjustment.currentStock },
      { previous: 5, current: 2 }
    );

    await registerPriceChange({
      productId: product.id, responsiblePhone: 'price-user', responsibleName: 'Price User',
      oldCashPrice: 100, oldCreditPrice: 110, newCashPrice: 120, newCreditPrice: 130,
    });
    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(Number(updatedProduct.cashPrice), 120);
    assert.equal(Number(updatedProduct.creditPrice), 130);
    assert.equal(updatedProduct.stock, 2);
    assert.equal(await prisma.movement.count(), 4);
    assert.equal((await findAvailableProductsByReference('175/70/14')).length, 1);

    assert.equal(
      await runPostCommitTask('simulated private notification', async () => {
        throw new Error('WhatsApp unavailable');
      }),
      false
    );
    assert.equal(await prisma.movement.count(), 4);
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
