import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('imports the motorcycle PDF catalog idempotently and preserves existing product ids', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-motorcycle-import-'));
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
    const renamed = await prisma.product.create({
      data: {
        reference: '80/100-14', description: 'SPM-M-10 SPM TT (T)',
        cashPrice: 159, creditPrice: 168.22, stock: 38,
        stockLocation: 'CG', imagePath: 'uploads/products/moto.jpg',
      },
    });
    const exact = await prisma.product.create({
      data: {
        reference: '90/90-21', description: 'M/C 54S CIBORG CB060',
        cashPrice: 100, creditPrice: 110, stock: 99,
      },
    });
    const legacyOnly = await prisma.product.create({
      data: {
        reference: '80/100-14', description: 'ST200 VIPAL',
        cashPrice: 189, creditPrice: 199.96, stock: 7,
      },
    });

    const preview = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importMotorcycleTires.ts'],
      { cwd: process.cwd(), env: congoEnvironment, encoding: 'utf8' }
    );
    assert.match(preview, /Catálogo de 15\/10\/2026: 46 modelos/);
    assert.equal(await prisma.product.count(), 3);

    execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importMotorcycleTires.ts', '--apply'],
      { cwd: process.cwd(), env: congoEnvironment, stdio: 'pipe' }
    );

    const updatedRenamed = await prisma.product.findUniqueOrThrow({ where: { id: renamed.id } });
    assert.equal(updatedRenamed.description, '49L SPM-M-10 SPM SEM CAMARA');
    assert.equal(updatedRenamed.category, 'MOTORCYCLE_TIRE');
    assert.equal(updatedRenamed.stock, 22);
    assert.equal(Number(updatedRenamed.cashPrice), 169);
    assert.equal(updatedRenamed.stockLocation, 'CG');
    assert.equal(updatedRenamed.imagePath, 'uploads/products/moto.jpg');

    const updatedExact = await prisma.product.findUniqueOrThrow({ where: { id: exact.id } });
    assert.equal(updatedExact.category, 'MOTORCYCLE_TIRE');
    assert.equal(updatedExact.stock, 1);
    assert.equal(Number(updatedExact.creditPrice), 231.7);

    const updatedLegacyOnly = await prisma.product.findUniqueOrThrow({ where: { id: legacyOnly.id } });
    assert.equal(updatedLegacyOnly.category, 'MOTORCYCLE_TIRE');
    assert.equal(updatedLegacyOnly.stock, 7);
    assert.equal(await prisma.product.count(), 47);

    const secondPreview = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importMotorcycleTires.ts'],
      { cwd: process.cwd(), env: congoEnvironment, encoding: 'utf8' }
    );
    assert.match(secondPreview, /Cadastros existentes a atualizar: 0/);
    assert.match(secondPreview, /Cadastros novos a criar: 0/);
    assert.match(secondPreview, /Cadastros anteriores a classificar como moto: 0/);

    assert.throws(() => execFileSync(
      process.execPath,
      [tsxCli, 'src/database/importMotorcycleTires.ts', '--apply'],
      {
        cwd: process.cwd(),
        env: { ...congoEnvironment, BRANCH_NAME: 'ATC PNEUS MONTEIRO' },
        stdio: 'pipe',
      }
    ));
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
