import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('updates Congo stock and prices, preserves identities and creates only approved missing products', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-catalog-sync-'));
  const databasePath = path.join(temporaryRoot, 'congo.db');
  const csvPath = path.join(temporaryRoot, 'congo.csv');
  const resolutionPath = path.join(temporaryRoot, 'resolution.csv');
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
      '175/70 R14,NOME EXISTENTE,350.00,370.00,8',
      '185/60 R15,NOME NOVO NA PLANILHA,450.00,480.00,6',
      '205/55 R16,PRODUTO NOVO,500.00,530.00,4',
    ].join('\n')
  );
  await writeFile(
    resolutionPath,
    [
      'csv_reference,csv_description,action,existing_reference,existing_description',
      '185/60 R15,NOME NOVO NA PLANILHA,MATCH,185/60 R15,NOME ANTIGO PRESERVADO',
      '205/55 R16,PRODUTO NOVO,CREATE,,',
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
    const existing = await prisma.product.create({
      data: {
        reference: '175/70 R14',
        description: 'NOME EXISTENTE',
        cashPrice: 300,
        creditPrice: 320,
        stock: 2,
        stockLocation: 'CG',
        imagePath: 'uploads/products/existing.jpg',
      },
    });
    const preserved = await prisma.product.create({
      data: {
        reference: '185/65 R15',
        description: 'FORA DO CSV',
        cashPrice: 400,
        creditPrice: 420,
        stock: 3,
      },
    });
    const renamedInCsv = await prisma.product.create({
      data: {
        reference: '185/60 R15',
        description: 'NOME ANTIGO PRESERVADO',
        cashPrice: 410,
        creditPrice: 430,
        stock: 1,
        imagePath: 'uploads/products/preserved-name.jpg',
      },
    });
    const user = await prisma.user.create({
      data: { name: 'Vendedor', phone: 'catalog-sync-user' },
    });
    await prisma.movement.create({
      data: {
        code: 'CATALOG-SYNC-HISTORY',
        type: 'SALE',
        productId: existing.id,
        userId: user.id,
        quantity: 1,
        previousStock: 3,
        newStock: 2,
        unitPrice: 300,
        totalValue: 300,
        paymentMethod: 'PIX',
      },
    });

    const dryRun = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductCatalog.ts', csvPath],
      { cwd: process.cwd(), env: congoEnvironment, encoding: 'utf8' }
    );
    assert.match(dryRun, /Produtos existentes a atualizar: 1/);
    assert.match(dryRun, /Produtos aprovados para cadastro novo: 0/);
    assert.match(dryRun, /Candidatos ainda sem decisão: 2/);
    assert.match(dryRun, /Produtos antigos preservados fora do CSV: 2/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: existing.id } })).stock, 2);
    assert.equal(await prisma.product.count(), 3);

    assert.throws(() =>
      execFileSync(
        process.execPath,
        [tsxCli, 'src/database/syncProductCatalog.ts', csvPath, '--apply'],
        { cwd: process.cwd(), env: congoEnvironment, stdio: 'pipe' }
      )
    );
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: existing.id } })).stock, 2);
    assert.equal(await prisma.product.count(), 3);

    execFileSync(
      process.execPath,
      [
        tsxCli,
        'src/database/syncProductCatalog.ts',
        csvPath,
        '--apply',
        '--resolution',
        resolutionPath,
      ],
      { cwd: process.cwd(), env: congoEnvironment, stdio: 'pipe' }
    );

    const updated = await prisma.product.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(updated.reference, '175/70 R14');
    assert.equal(updated.description, 'NOME EXISTENTE');
    assert.equal(updated.stock, 8);
    assert.equal(Number(updated.cashPrice), 350);
    assert.equal(Number(updated.creditPrice), 370);
    assert.equal(updated.stockLocation, 'CG');
    assert.equal(updated.imagePath, 'uploads/products/existing.jpg');
    assert.equal(await prisma.movement.count(), 1);

    const preservedIdentity = await prisma.product.findUniqueOrThrow({
      where: { id: renamedInCsv.id },
    });
    assert.equal(preservedIdentity.reference, '185/60 R15');
    assert.equal(preservedIdentity.description, 'NOME ANTIGO PRESERVADO');
    assert.equal(preservedIdentity.stock, 6);
    assert.equal(Number(preservedIdentity.cashPrice), 450);
    assert.equal(Number(preservedIdentity.creditPrice), 480);
    assert.equal(preservedIdentity.imagePath, 'uploads/products/preserved-name.jpg');

    const created = await prisma.product.findFirstOrThrow({
      where: { reference: '205/55 R16', description: 'PRODUTO NOVO' },
    });
    assert.equal(created.stock, 4);
    assert.equal(Number(created.cashPrice), 500);
    assert.equal(Number(created.creditPrice), 530);
    assert.equal(created.stockLocation, null);
    assert.equal(created.imagePath, null);

    const untouched = await prisma.product.findUniqueOrThrow({ where: { id: preserved.id } });
    assert.equal(untouched.description, 'FORA DO CSV');
    assert.equal(untouched.stock, 3);
    assert.equal(await prisma.product.count(), 4);

    const secondDryRun = execFileSync(
      process.execPath,
      [tsxCli, 'src/database/syncProductCatalog.ts', csvPath, '--resolution', resolutionPath],
      { cwd: process.cwd(), env: congoEnvironment, encoding: 'utf8' }
    );
    assert.match(secondDryRun, /Produtos existentes a atualizar: 0/);
    assert.match(secondDryRun, /Produtos existentes já corretos: 3/);
    assert.match(secondDryRun, /Candidatos ainda sem decisão: 0/);

    assert.throws(() =>
      execFileSync(process.execPath, [tsxCli, 'src/database/syncProductCatalog.ts', csvPath], {
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
