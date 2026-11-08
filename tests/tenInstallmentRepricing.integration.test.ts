import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('cash price changes update only the changed product 10X price and preserve recorded sales', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-ten-repricing-'));
  const database = path.join(root, 'test.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { prisma } = await import('../src/database/prisma.js');
  const { registerPriceChange } = await import('../src/services/priceService.js');
  const { registerEntryItems } = await import('../src/services/entryService.js');
  const { registerSale } = await import('../src/services/saleService.js');
  const responsible = { responsiblePhone: 'synthetic-price-user', responsibleName: 'Synthetic' };
  const makeProduct = (description: string, cashPrice = 100, tenInstallmentPrice = 149.99) => prisma.product.create({
    data: { reference: '175/70 R14', description, stock: 5, cashPrice, creditPrice: 105.8, tenInstallmentPrice },
  });
  try {
    const changed = await makeProduct('CHANGED');
    const same = await makeProduct('SAME', 100, 159.99);
    const untouched = await makeProduct('UNTOUCHED', 100, 169.99);
    const round = await makeProduct('ROUND', 1.20, 1.99);
    await registerSale({ productId: changed.id, sellerPhone: 'synthetic-seller', sellerName: 'Synthetic',
      quantity: 1, unitPrice: 149.99, totalValue: 149.99, paymentMethod: 'Cartão' });
    const historyBefore = await prisma.movement.findMany({ where: { type: 'SALE' } });
    await registerPriceChange({ ...responsible, productId: changed.id,
      oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: 120 });
    let result = await prisma.product.findUniqueOrThrow({ where: { id: changed.id } });
    assert.equal(Number(result.cashPrice), 120);
    assert.equal(Number(result.creditPrice), 126.96);
    assert.equal(Number(result.tenInstallmentPrice), 131.04);
    await registerPriceChange({ ...responsible, productId: changed.id,
      oldCashPrice: 120, oldCreditPrice: 126.96, newCashPrice: 121 });
    result = await prisma.product.findUniqueOrThrow({ where: { id: changed.id } });
    assert.equal(Number(result.tenInstallmentPrice), 132.13, 'Apply markup to the new cash price, never to the previous 10X.');
    await registerPriceChange({ ...responsible, productId: same.id,
      oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: 100 });
    assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: same.id } })).tenInstallmentPrice), 159.99);
    await registerEntryItems({ ...responsible, items: [
      { productId: round.id, quantity: 1, supplier: 'Synthetic', newCashPrice: 1.25 },
      { productId: same.id, quantity: 1, supplier: 'Synthetic', newCashPrice: 100 },
      { productId: untouched.id, quantity: 1, supplier: 'Synthetic' },
    ] });
    assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: round.id } })).tenInstallmentPrice), 1.37);
    assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: same.id } })).tenInstallmentPrice), 159.99);
    assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: untouched.id } })).tenInstallmentPrice), 169.99);
    assert.deepEqual(await prisma.movement.findMany({ where: { type: 'SALE' } }), historyBefore);
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
