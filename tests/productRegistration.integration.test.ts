import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('creates new products atomically, records initial stock and blocks equivalent duplicates', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-product-registration-'));
  const databasePath = path.join(temporaryRoot, 'registration.db');
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
    ProductAlreadyExistsError,
    registerNewProduct,
  } = await import('../src/services/productRegistrationService.js');

  try {
    const registeredWithStock = await registerNewProduct({
      reference: '18.4/30',
      description: 'ALLIANCE AGRI NOVA 14 LONAS',
      initialStock: 2,
      supplier: 'JTR Pneus',
      cashPrice: 4600,
      stockLocation: 'W3',
      responsiblePhone: 'registration-user',
      responsibleName: 'Registration User',
    });

    const productWithStock = await prisma.product.findUniqueOrThrow({
      where: { id: registeredWithStock.productId },
    });
    assert.equal(productWithStock.reference, '18.4/30');
    assert.equal(productWithStock.description, 'ALLIANCE AGRI NOVA 14 LONAS');
    assert.equal(productWithStock.stock, 2);
    assert.equal(productWithStock.minStock, 0);
    assert.equal(productWithStock.stockLocation, 'W3');
    assert.equal(Number(productWithStock.cashPrice), 4600);
    assert.equal(Number(productWithStock.creditPrice), 4866.8);
    assert.match(registeredWithStock.movementCode ?? '', /^#E-\d{6}$/);

    const initialEntry = await prisma.movement.findUniqueOrThrow({
      where: { code: registeredWithStock.movementCode! },
    });
    assert.equal(initialEntry.type, 'ENTRY');
    assert.equal(initialEntry.quantity, 2);
    assert.equal(initialEntry.previousStock, 0);
    assert.equal(initialEntry.newStock, 2);
    assert.equal(initialEntry.supplier, 'JTR Pneus');

    const registeredWithoutStock = await registerNewProduct({
      reference: '110/90 R17',
      description: 'PIRELLI MT60 TRASEIRO 60P',
      initialStock: 0,
      cashPrice: 500,
      responsiblePhone: 'registration-user',
      responsibleName: 'Registration User',
    });
    assert.equal(registeredWithoutStock.movementCode, null);
    assert.equal(
      (await prisma.product.findUniqueOrThrow({ where: { id: registeredWithoutStock.productId } }))
        .stock,
      0
    );
    assert.equal(await prisma.movement.count(), 1);

    await assert.rejects(
      registerNewProduct({
        reference: '18.4-30',
        description: 'ALLIANCE AGRI NOVA 14 LONAS',
        initialStock: 5,
        supplier: 'Outro fornecedor',
        cashPrice: 4700,
        responsiblePhone: 'other-user',
        responsibleName: 'Other User',
      }),
      ProductAlreadyExistsError
    );
    assert.equal(await prisma.product.count(), 2);
    assert.equal(await prisma.movement.count(), 1);
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
