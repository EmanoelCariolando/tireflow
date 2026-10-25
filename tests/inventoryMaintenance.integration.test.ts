import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('inventory maintenance preserves movements using disposable SQLite', { timeout: 120000 }, async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tireflow-maintenance-'));
  const database = path.join(root, 'maintenance.sqlite');
  await fs.writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  process.env.BRANCH_NAME = 'ATC PNEUS MONTEIRO TESTE';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { prisma } = await import('../src/database/prisma.js');
  const { createBackup } = await import('../src/database/backup.js');
  const { acquireDatabaseMaintenanceLock } = await import('../src/database/maintenanceLock.js');
  const { registerSale } = await import('../src/services/saleService.js');
  const { registerEntry } = await import('../src/services/entryService.js');
  const { registerPriceChange } = await import('../src/services/priceService.js');
  const { registerPendingSale } = await import('../src/services/pendingSaleService.js');
  let sequence = 0;
  const product = (stock = 5) => prisma.product.create({ data: { reference: '175/70 R14', description: `MAINT ${++sequence}`,
    stock, stockLocation: 'CG', cashPrice: 100, creditPrice: 105.8 } });
  const run = (script: string, args: string[], branch = 'MONTEIRO') => spawnSync(process.execPath,
    ['--import', 'tsx', `src/database/${script}.ts`, ...args], { encoding: 'utf8', timeout: 20000,
      env: { ...process.env, BRANCH_NAME: `ATC PNEUS ${branch} TESTE`, BACKUP_ROOT: path.join(root, `safety-${++sequence}`) } });
  const sale = (productId: string, quantity: number) => registerSale({ productId, quantity, sellerPhone: 'maintenance-user', sellerName: 'Teste',
    unitPrice: 100, totalValue: quantity * 100, paymentMethod: 'Dinheiro' });
  try {
    for (const scenario of ['sale-to-zero', 'reservation-to-zero', 'same-balance']) {
      await t.test(`restoration preserves ${scenario}, while restoring unaffected products`, async () => {
        const changed = await product();
        const safe = await product(3);
        const backup = await createBackup({ backupRoot: path.join(root, `original-${++sequence}`), retention: 99 });
        if (scenario === 'reservation-to-zero') await registerPendingSale({
          createdByPhone: 'maintenance-user', createdByName: 'Teste', assignedPhone: 'assignee', assignedName: 'Outro', totalValue: 500,
          items: [{ productId: changed.id, reference: changed.reference, description: changed.description,
            quantity: 5, cashPrice: 100, creditPrice: 105.8, priceType: 'À vista', unitPrice: 100, totalValue: 500 }],
        });
        else {
          await sale(changed.id, scenario === 'sale-to-zero' ? 5 : 1);
          if (scenario === 'same-balance') await registerEntry({ productId: changed.id, quantity: 1, supplier: 'Teste',
            responsiblePhone: 'maintenance-user', responsibleName: 'Teste' });
        }
        await prisma.product.update({ where: { id: changed.id }, data: { stockLocation: null } });
        await prisma.product.update({ where: { id: safe.id }, data: { stock: 0, stockLocation: null } });
        const before = await prisma.product.findUniqueOrThrow({ where: { id: changed.id } });
        const strict = run('restoreLocationStock', [backup, 'CG', '--apply']);
        assert.equal(strict.status, 1, strict.stdout + strict.stderr);
        assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: safe.id } })).stock, 0);
        const result = run('restoreLocationStock', [backup, 'CG', '--apply-safe']);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const after = await prisma.product.findUniqueOrThrow({ where: { id: changed.id } });
        assert.equal(after.stock, before.stock);
        assert.equal(after.stockLocation, null);
        assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: safe.id } })).stock, 3);
      });
    }
    await t.test('an administrative clear remains restorable and a price-only change is preserved', async () => {
      const p = await product();
      const backup = await createBackup({ backupRoot: path.join(root, `original-${++sequence}`) });
      await registerPriceChange({ productId: p.id, oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: 120,
        responsiblePhone: 'maintenance-user', responsibleName: 'Teste' });
      await prisma.product.update({ where: { id: p.id }, data: { stock: 0, stockLocation: null } });
      const result = run('restoreLocationStock', [backup, 'CG', '--apply']);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const restored = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
      assert.equal(restored.stock, 5);
      assert.equal(restored.stockLocation, 'CG');
      assert.equal(Number(restored.cashPrice), 120);
    });
    const p = await product();
    const csv = path.join(root, 'stocks.csv');
    await fs.writeFile(csv, `reference,description,stock,cash_price,credit_price\n${p.reference},${p.description},2,100.00,105.80\n`);
    const commands: Array<[string, string[], string]> = [
      ['syncProductStocks', [csv, '--apply'], 'CONGO'], ['syncProductCatalog', [csv, '--apply'], 'CONGO'],
      ['importMotorcycleTires', ['--apply'], 'CONGO'], ['importRetreadedTires', ['--apply'], 'CONGO'],
      ['clearLocationStock', ['CG', '--apply'], 'MONTEIRO'],
      ['restoreLocationStock', [path.join(root, 'not-opened'), 'CG', '--apply-safe'], 'MONTEIRO'],
    ];
    const release = await acquireDatabaseMaintenanceLock(database);
    try {
      for (const [script, args, branch] of commands) await t.test(`${script} refuses an active writer before changing data`, async () => {
        const before = await prisma.product.findMany({ orderBy: { id: 'asc' } });
        const result = run(script, args, branch);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /bloqueio|uso|ativo/);
        assert.deepEqual(await prisma.product.findMany({ orderBy: { id: 'asc' } }), before);
      });
      await t.test('stock dry-run remains available while the app holds the lock', () => {
        const result = run('syncProductStocks', [csv], 'CONGO');
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Nenhuma alteração/);
      });
    } finally { await release(); }
    await t.test('failed preflight releases its own lock and a later valid load works', async () => {
      const invalid = path.join(root, 'invalid.csv');
      await fs.writeFile(invalid, 'invalid');
      assert.equal(run('syncProductStocks', [invalid, '--apply'], 'CONGO').status, 1);
      await assert.rejects(fs.stat(`${database}.tireflow-lock`), { code: 'ENOENT' });
      const result = run('syncProductStocks', [csv, '--apply'], 'CONGO');
      assert.equal(result.status, 0, result.stderr);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock, 2);
      await assert.rejects(fs.stat(`${database}.tireflow-lock`), { code: 'ENOENT' });
    });
    await t.test('a real load holds the existing lock across its read and write', async () => {
      const source = `
        const {prisma}=await import('./src/database/prisma.ts');
        const original=prisma.product.findMany.bind(prisma.product);
        prisma.product.findMany=async(...args)=>{ console.log('LOAD_READ_READY'); await new Promise(resolve=>process.stdin.once('data',resolve)); return original(...args); };
        process.argv=[process.execPath,'src/database/syncProductStocks.ts',${JSON.stringify(csv)},'--apply'];
        await import('./src/database/syncProductStocks.ts');
      `;
      const held = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
        env: { ...process.env, BRANCH_NAME: 'ATC PNEUS CONGO TESTE' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      try {
        let output = '';
        while (!output.includes('LOAD_READ_READY')) {
          const [chunk] = await once(held.stdout, 'data', { signal: AbortSignal.timeout(15000) });
          output += String(chunk);
        }
        await assert.rejects(async () => {
          const unexpectedRelease = await acquireDatabaseMaintenanceLock(database);
          await unexpectedRelease();
        }, /bloqueio|uso|ativo/);
        const result = run('syncProductStocks', [csv, '--apply'], 'CONGO');
        assert.equal(result.status, 1, result.stderr);
      } finally {
        const exited = once(held, 'exit');
        held.stdin.end('continue');
        const [code] = await exited;
        assert.equal(code, 0);
      }
    });
  } finally {
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
