import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('imports the priced retreaded-tire catalog idempotently and preserves existing identities', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-retread-import-'));
  const databasePath = path.join(temporaryRoot, 'congo.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const congoEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BRANCH_NAME: 'ATC PNEUS CONGO',
  };

  await writeFile(databasePath, '');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(), env: congoEnvironment, stdio: 'pipe',
  });
  process.env.DATABASE_URL = databaseUrl;
  const { prisma } = await import('../src/database/prisma.js');

  try {
    const existing = await prisma.product.create({
      data: {
        reference: 'COB-MT-14-TRAZ-POP',
        description: 'PN MT COBERTO 14 TRAZ POP',
        cashPrice: 90,
        creditPrice: 95,
        stock: 1,
        stockLocation: 'CG',
        imagePath: 'uploads/products/coberto.jpg',
      },
    });

    const preview = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importRetreadedTires.ts'],
      { cwd: process.cwd(), env: congoEnvironment, encoding: 'utf8' }
    );
    assert.match(preview, /17 modelos com preço/);
    assert.equal(await prisma.product.count(), 1);

    execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importRetreadedTires.ts', '--apply'],
      { cwd: process.cwd(), env: congoEnvironment, stdio: 'pipe' }
    );

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(updated.category, 'MOTORCYCLE_RETREADED_TIRE');
    assert.equal(updated.stock, 5);
    assert.equal(Number(updated.cashPrice), 95);
    assert.equal(Number(updated.tenInstallmentPrice), 103.74);
    assert.equal(updated.stockLocation, 'CG');
    assert.equal(updated.imagePath, 'uploads/products/coberto.jpg');
    assert.equal(await prisma.product.count(), 17);

    const rear750 = await prisma.product.findFirstOrThrow({
      where: { reference: 'COB-16-750-16-TRAZ' },
    });
    assert.equal(rear750.stock, 4);

    const duplicateDescription = await prisma.product.findMany({
      where: { description: 'P16 COBERTO 295 80 22.5 DIR' },
      orderBy: { cashPrice: 'asc' },
    });
    assert.deepEqual(duplicateDescription.map((product) => Number(product.cashPrice)), [1149, 1199]);

    const secondPreview = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importRetreadedTires.ts'],
      { cwd: process.cwd(), env: congoEnvironment, encoding: 'utf8' }
    );
    assert.match(secondPreview, /Cadastros existentes a atualizar: 0/);
    assert.match(secondPreview, /Cadastros novos a criar: 0/);
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
