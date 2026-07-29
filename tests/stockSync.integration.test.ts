import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('syncs only Congo stocks and preserves existing operational data', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-stock-sync-'));
  const databasePath = path.join(temporaryRoot, 'congo.db');
  const csvPath = path.join(temporaryRoot, 'congo.csv');
  const missingCsvPath = path.join(temporaryRoot, 'congo-missing.csv');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const congoEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BRANCH_NAME: 'ATC PNEUS CONGO',
  };

  await writeFile(databasePath, '');
  await writeFile(
    csvPath,
    [
      'reference,description,cash_price,credit_price,stock',
      '175/70 R14,PNEU EXISTENTE,300.00,320.00,2',
    ].join('\n')
  );
  await writeFile(
    missingCsvPath,
    [
      'reference,description,cash_price,credit_price,stock',
      '175/70 R14,PNEU EXISTENTE,999.00,999.00,1',
      '999/99 R99,PRODUTO AUSENTE,1.00,2.00,8',
    ].join('\n')
  );

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: congoEnvironment,
    stdio: 'pipe',
  });
  process.env.DATABASE_URL = databaseUrl;

  const { prisma } = await import('../src/database/prisma.js');

  try {
    const product = await prisma.product.create({
      data: {
        reference: '175/70 R14',
        description: 'PNEU EXISTENTE',
        stock: 5,
        stockLocation: 'CG',
        cashPrice: 300,
        creditPrice: 320,
        imagePath: 'uploads/products/existing.jpg',
      },
    });
    const user = await prisma.user.create({
      data: { name: 'Vendedor', phone: 'sync-stock-user' },
    });
    await prisma.movement.create({
      data: {
        code: 'SYNC-STOCK',
        type: 'SALE',
        productId: product.id,
        userId: user.id,
        quantity: 1,
        previousStock: 6,
        newStock: 5,
        unitPrice: 300,
        totalValue: 300,
        paymentMethod: 'PIX',
      },
    });

    const dryRun = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductStocks.ts', csvPath],
      {
        cwd: process.cwd(),
        env: congoEnvironment,
        encoding: 'utf8',
      }
    );
    assert.match(dryRun, /Estoques a atualizar: 1/);
    assert.match(dryRun, /5 -> 2/);
    assert.match(dryRun, /Nenhuma alteração foi feita/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 5);

    execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductStocks.ts', csvPath, '--apply'],
      {
        cwd: process.cwd(),
        env: congoEnvironment,
        stdio: 'pipe',
      }
    );

    const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(updatedProduct.stock, 2);
    assert.equal(updatedProduct.reference, '175/70 R14');
    assert.equal(updatedProduct.description, 'PNEU EXISTENTE');
    assert.equal(Number(updatedProduct.cashPrice), 300);
    assert.equal(Number(updatedProduct.creditPrice), 320);
    assert.equal(updatedProduct.imagePath, 'uploads/products/existing.jpg');
    assert.equal(updatedProduct.stockLocation, 'CG');
    assert.equal(await prisma.movement.count(), 1);

    const secondDryRun = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductStocks.ts', csvPath],
      {
        cwd: process.cwd(),
        env: congoEnvironment,
        encoding: 'utf8',
      }
    );
    assert.match(secondDryRun, /Estoques a atualizar: 0/);
    assert.match(secondDryRun, /Estoques já corretos: 1/);

    assert.throws(() =>
      execFileSync(process.execPath, [tsxCli, 'src/database/syncProductStocks.ts', missingCsvPath], {
        cwd: process.cwd(),
        env: congoEnvironment,
        stdio: 'pipe',
      })
    );
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 2);

    assert.throws(() =>
      execFileSync(process.execPath, [tsxCli, 'src/database/syncProductStocks.ts', csvPath], {
        cwd: process.cwd(),
        env: { ...congoEnvironment, BRANCH_NAME: 'ATC PNEUS MONTEIRO' },
        stdio: 'pipe',
      })
    );
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
