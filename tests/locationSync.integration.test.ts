import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('syncs only Monteiro locations and preserves existing operational data', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-location-sync-'));
  const databasePath = path.join(temporaryRoot, 'monteiro.db');
  const csvPath = path.join(temporaryRoot, 'monteiro.csv');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const monteiroEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BRANCH_NAME: 'ATC PNEUS MONTEIRO',
  };

  await writeFile(databasePath, '');
  await writeFile(
    csvPath,
    [
      'reference,description,cash_price,credit_price,stock,location',
      '175/70 R14,PNEU EXISTENTE,300.00,320.00,3,CG',
    ].join('\n')
  );

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: monteiroEnvironment,
    stdio: 'pipe',
  });
  process.env.DATABASE_URL = databaseUrl;

  const { prisma } = await import('../src/database/prisma.js');

  try {
    const product = await prisma.product.create({
      data: {
        reference: '175/70 R14',
        description: 'PNEU EXISTENTE',
        stock: 3,
        cashPrice: 300,
        creditPrice: 320,
      },
    });
    const user = await prisma.user.create({
      data: { name: 'Vendedor', phone: 'sync-location-user' },
    });
    await prisma.movement.create({
      data: {
        code: 'SYNC-LOCATION',
        type: 'SALE',
        productId: product.id,
        userId: user.id,
        quantity: 1,
        previousStock: 4,
        newStock: 3,
        unitPrice: 300,
        totalValue: 300,
        paymentMethod: 'PIX',
      },
    });

    const dryRun = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductLocations.ts', csvPath],
      {
        cwd: process.cwd(),
        env: monteiroEnvironment,
        encoding: 'utf8',
      }
    );
    assert.match(dryRun, /Localizações a atualizar: 1/);
    assert.match(dryRun, /Nenhuma alteração foi feita/);
    assert.equal(
      (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stockLocation,
      null
    );

    execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductLocations.ts', csvPath, '--apply'],
      {
        cwd: process.cwd(),
        env: monteiroEnvironment,
        stdio: 'pipe',
      }
    );

    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(updatedProduct.stockLocation, 'CG');
    assert.equal(updatedProduct.stock, 3);
    assert.equal(Number(updatedProduct.cashPrice), 300);
    assert.equal(Number(updatedProduct.creditPrice), 320);
    assert.equal(await prisma.movement.count(), 1);

    assert.throws(() =>
      execFileSync(process.execPath, [tsxCli, 'src/database/syncProductLocations.ts', csvPath], {
        cwd: process.cwd(),
        env: { ...monteiroEnvironment, BRANCH_NAME: 'ATC PNEUS CONGO' },
        stdio: 'pipe',
      })
    );
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
