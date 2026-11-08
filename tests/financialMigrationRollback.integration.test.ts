import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { ClosingSnapshot } from '../src/services/financialService.js';

const migrationName = '20261102000000_add_sale_reversals_and_financial_closings';
const financialModels = 'FinancialClosing|FinancialClosingSeller|SaleReversal|SaleReversalItem|SaleReversalReturn|CommissionAdjustment';
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function contents(client: PrismaClient, tables?: string[]) {
  const names = tables ?? (await client.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name"
  )).map(row => row.name);
  const result: Record<string, unknown> = {};
  for (const name of names) result[name] = await client.$queryRawUnsafe(`SELECT * FROM ${quote(name)} ORDER BY rowid`);
  return result;
}

test('a pre-financial installation migrates without changing old rows and restores using matching schema tooling', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-finance-upgrade-'));
  const legacy = path.join(root, 'legacy-release');
  const schemaPath = path.join(legacy, 'prisma/schema.prisma');
  const database = path.join(root, 'installation.sqlite');
  const dependencyLinks: string[] = [];
  const cli = path.resolve('node_modules/prisma/build/index.js');
  const databaseUrl = `file:${database.replaceAll('\\', '/')}`;
  const environment = { ...process.env, DATABASE_URL: databaseUrl, PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true' };
  process.env.DATABASE_URL = databaseUrl;
  let current: Awaited<typeof import('../src/database/prisma.js')> | undefined;
  const clients: PrismaClient[] = [];
  const client = (filename: string) => {
    assert.ok(filename.startsWith(root + path.sep), 'Every database must stay inside the disposable fixture.');
    const value = new PrismaClient({ datasourceUrl: `file:${filename.replaceAll('\\', '/')}` });
    clients.push(value);
    return value;
  };
  const command = (args: string[], cwd = process.cwd()) => execFileSync(process.execPath, [cli, ...args], {
    env: environment, cwd, stdio: 'pipe', timeout: 60000,
  }).toString();
  const legacyWorker = (input: string) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
      cwd: legacy, env: environment, input, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  };
  try {
    await mkdir(path.dirname(schemaPath), { recursive: true });
    const schema = (await readFile('prisma/schema.prisma', 'utf8'))
      .replace(new RegExp(`^model (${financialModels}) \\{[\\s\\S]*?^\\}\\s*`, 'gm'), '')
      .split(/\r?\n/).filter(line => !new RegExp(`^\\s+\\w+\\s+(?:${financialModels})(?:\\[\\]|\\?)?(?:\\s|$)`).test(line)).join('\n')
      .replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "../node_modules/.prisma/client"');
    assert.doesNotMatch(schema, new RegExp(`\\b(?:${financialModels})\\b`));
    await writeFile(schemaPath, schema);
    await writeFile(path.join(legacy, 'package.json'), '{"name":"synthetic-previous-release","type":"module"}');
    await writeFile(path.join(legacy, '.env.example'), '# Synthetic fixture only\n');
    await mkdir(path.join(legacy, 'prisma/migrations'));
    const priorMigrations = (await readdir('prisma/migrations', { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && entry.name < migrationName).map(entry => entry.name).sort();
    assert.ok(priorMigrations.length > 0);
    for (const name of priorMigrations) await cp(`prisma/migrations/${name}`, path.join(legacy, 'prisma/migrations', name), { recursive: true });
    await cp('prisma/migrations/migration_lock.toml', path.join(legacy, 'prisma/migrations/migration_lock.toml'));
    command(['validate', '--schema', schemaPath], legacy);
    command(['migrate', 'deploy', '--schema', schemaPath], legacy);
    await cp('node_modules/@prisma/client', path.join(legacy, 'node_modules/@prisma/client'), { recursive: true });
    command(['generate', '--schema', schemaPath], legacy);
    for (const name of ['tsx', 'dotenv']) {
      const destination = path.join(legacy, 'node_modules', name);
      await symlink(path.resolve('node_modules', name), destination, 'junction');
      dependencyLinks.push(destination);
    }
    // These unchanged restoration modules are exercised with the previous schema/client.
    for (const name of ['config/appPaths.ts', 'config/env.ts', 'utils/messageContext.ts',
      'database/prisma.ts', 'database/databasePath.ts', 'database/backup.ts', 'database/restoreBackup.ts',
      'database/backupValidation.ts', 'database/maintenanceLock.ts', 'services/productPhotoStorage.ts']) {
      const destination = path.join(legacy, 'src', name);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join('src', name), destination);
    }
    const photos = path.join(legacy, 'uploads/products');
    await mkdir(photos, { recursive: true });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    await writeFile(path.join(photos, 'synthetic.png'), png);
    const db = client(database);
    const admin = await db.user.create({ data: { name: 'Legacy Admin', phone: 'legacy-admin', role: 'ADMIN' } });
    const seller = await db.user.create({ data: { name: 'Legacy Seller', phone: 'legacy-seller' } });
    const tire = await db.product.create({ data: { reference: '175/70 R14', description: 'LEGACY SYNTHETIC', stock: 5,
      cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: 149.99, imagePath: 'uploads/products/synthetic.png' } });
    const battery = await db.product.create({ data: { reference: '60AH', description: 'LEGACY BATTERY', category: 'BATTERY',
      stock: 5, cashPrice: 50, creditPrice: 52.9, tenInstallmentPrice: null } });
    const historicalDate = new Date('2026-08-05T12:00:00-03:00');
    for (const [code, productId, quantity, amount, paymentMethod, isCityHallSale] of [
      ['#V-000001', tire.id, 3, 100, 'Dinheiro', false], ['#V-000002', battery.id, 1, 50, 'PIX', false],
      ['#V-000003', tire.id, 1, 25, 'Nota', true], ['#V-000004', tire.id, 1, 10, null, false],
    ] as const) {
      await db.movement.create({ data: { code, type: 'SALE', productId, userId: seller.id, quantity, totalValue: amount,
        unitPrice: amount / quantity, paymentMethod, isCityHallSale, commissionPercent: null, saleGroupCode: null,
        previousStock: 5 + quantity, newStock: 5, createdAt: historicalDate } });
    }
    const legacyContents = await contents(db);
    const originalSales = await db.movement.findMany({ orderBy: { code: 'asc' } });
    await db.$disconnect();
    const backupResult = legacyWorker(`const { createBackup } = await import('./src/database/backup.ts');
      const { prisma } = await import('./src/database/prisma.ts');
      try { const backup = await createBackup({backupRoot:${JSON.stringify(path.join(root, 'pre-upgrade-backups'))},now:new Date('2026-09-01T12:00:00-03:00')});
        console.log(JSON.stringify({backup})); } finally {await prisma.$disconnect();}`);
    const backupPath = backupResult.backup as string;
    assert.ok(backupPath.startsWith(root + path.sep));
    const backupHash = createHash('sha256').update(await readFile(path.join(backupPath, 'database.sqlite'))).digest('hex');

    await t.test('failed migration blocks a blind retry and restores safely before releasing any writes', async () => {
      const failedRelease = path.join(root, 'failed-release');
      const failedDatabase = path.join(root, 'failed-installation.sqlite');
      await cp('prisma', path.join(failedRelease, 'prisma'), { recursive: true,
        filter: filename => !/\.(?:db|sqlite)(?:$|-)/i.test(path.basename(filename)) });
      await writeFile(path.join(failedRelease, 'package.json'), '{"name":"synthetic-failed-release","type":"module"}');
      await cp(path.join(backupPath, 'database.sqlite'), failedDatabase);
      const failedSql = path.join(failedRelease, 'prisma/migrations', migrationName, 'migration.sql');
      await writeFile(failedSql, (await readFile(failedSql, 'utf8')) + '\nSYNTHETIC INVALID SQL;\n');
      const deploy = () => spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.join(failedRelease, 'prisma/schema.prisma')], {
        env: { ...environment, DATABASE_URL: `file:${failedDatabase.replaceAll('\\', '/')}` },
        cwd: failedRelease, encoding: 'utf8', timeout: 30000,
      });
      const failure = deploy();
      assert.notEqual(failure.status, 0);
      assert.match(failure.stderr, /P3018|migration failed/i);
      const failed = client(failedDatabase);
      assert.deepEqual(await contents(failed, Object.keys(legacyContents)), legacyContents);
      const states = await failed.$queryRawUnsafe<Array<{ finished_at: unknown; rolled_back_at: unknown }>>(
        'SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = ?', migrationName);
      assert.equal(states.length, 1);
      assert.equal(states[0].finished_at, null);
      assert.equal(states[0].rolled_back_at, null);
      await failed.$disconnect();
      const retry = deploy();
      assert.notEqual(retry.status, 0);
      assert.match(retry.stderr, /P3009|failed migrations/i);
      legacyWorker(`const { restoreBackupToTargets } = await import('./src/database/restoreBackup.ts');
        await restoreBackupToTargets(${JSON.stringify(backupPath)},${JSON.stringify({
          databasePath: failedDatabase, uploadsPath: path.join(root, 'failed-installation-photos'),
        })}); console.log(JSON.stringify({restored:true}));`);
      assert.deepEqual(await contents(failed), legacyContents);
      const applied = await failed.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name');
      assert.deepEqual(applied.map(row => row.migration_name), priorMigrations);
    });

    await t.test('additive migration preserves every pre-existing table row and independently imported 10X prices', async () => {
      const sql = await readFile(`prisma/migrations/${migrationName}/migration.sql`, 'utf8');
      assert.ok(sql.split(';').filter(statement => statement.trim()).every(statement => /^\s*CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b/i.test(statement)));
      command(['migrate', 'deploy']);
      assert.deepEqual(await contents(db, Object.keys(legacyContents)), legacyContents);
      assert.equal(Number((await db.product.findUniqueOrThrow({ where: { id: tire.id } })).tenInstallmentPrice), 149.99);
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: battery.id } })).tenInstallmentPrice, null);
      assert.equal(await db.saleReversal.count(), 0);
      assert.equal(await db.financialClosing.count(), 0);
      assert.match(command(['migrate', 'status']), /up to date/i);
      command(['migrate', 'deploy']);
      assert.deepEqual(await contents(db, Object.keys(legacyContents)), legacyContents);
      assert.deepEqual(await db.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
      assert.deepEqual(await db.$queryRawUnsafe('PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
    });

    current = await import('../src/database/prisma.js');
    const financial = await import('../src/services/financialService.js');
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-02T12:00:00-03:00') });
    await t.test('old null commission/group fields and category exemptions remain usable without rewriting sales', async () => {
      const preview = await financial.previewFinancialClosing(admin.phone, '2026-08');
      assert.equal(preview.snapshot.sellers[0].earned, 270);
      await financial.closeFinancialMonth(admin.phone, '2026-08', preview.hash);
      await financial.markClosingCommissionPaid(admin.phone, '2026-08', 1);
      await assert.rejects(financial.registerSaleReversal({ actorPhone: admin.phone, operationId: 'invalid-legacy-payment',
        saleCode: '#V-000004', reason: 'Synthetic missing payment metadata', selections: 'all' }), /detalhamento de pagamento/);
      await financial.registerSaleReversal({ actorPhone: admin.phone, operationId: 'legacy-valid-reversal',
        saleCode: '#V-000001', reason: 'Synthetic return', selections: [{ position: 1, quantity: 3, returnedQuantity: 2 }] });
      assert.equal((await db.product.findUniqueOrThrow({ where: { id: tire.id } })).stock, 7);
      t.mock.timers.setTime(new Date('2026-10-02T12:00:00-03:00').getTime());
      const next = await financial.previewFinancialClosing(admin.phone, '2026-09');
      const closing = await financial.closeFinancialMonth(admin.phone, '2026-09', next.hash);
      assert.equal((JSON.parse(closing.snapshotJson) as ClosingSnapshot).sellers[0].adjustments, -200);
      assert.deepEqual(await db.movement.findMany({ where: { type: 'SALE' }, orderBy: { code: 'asc' } }), originalSales);
    });

    await t.test('a backup after financial operations restores the entire ledger, stock, payment status and photos', async () => {
      const { PRODUCT_UPLOAD_DIRECTORY } = await import('../src/config/appPaths.js');
      assert.ok(PRODUCT_UPLOAD_DIRECTORY.startsWith(process.cwd() + path.sep));
      await writeFile(path.join(PRODUCT_UPLOAD_DIRECTORY, 'synthetic.png'), png);
      const { createBackup } = await import('../src/database/backup.js');
      const { restoreBackupToTargets } = await import('../src/database/restoreBackup.js');
      const backup = await createBackup({ backupRoot: path.join(root, 'post-upgrade-backups'), now: new Date('2026-10-02T12:00:00-03:00') });
      const expected = await contents(db);
      const restoredDatabase = path.join(root, 'post-restored/database.sqlite');
      const restoredPhotos = path.join(root, 'post-restored/uploads/products');
      await restoreBackupToTargets(backup, { databasePath: restoredDatabase, uploadsPath: restoredPhotos });
      const restored = client(restoredDatabase);
      assert.deepEqual(await contents(restored), expected);
      assert.deepEqual(await readFile(path.join(restoredPhotos, 'synthetic.png')), png);
      assert.equal(await restored.saleReversal.count(), 1);
      assert.equal(await restored.financialClosing.count(), 2);
      assert.equal(await restored.financialClosingSeller.count({ where: { paidAt: { not: null } } }), 1);
    });

    await t.test('new restore tooling refuses an old schema, and matching legacy tooling restores the pre-upgrade snapshot', async () => {
      const { restoreBackupToTargets } = await import('../src/database/restoreBackup.js');
      const restoredDatabase = path.join(root, 'rollback/database.sqlite');
      const restoredPhotos = path.join(root, 'rollback/uploads/products');
      await assert.rejects(restoreBackupToTargets(backupPath, { databasePath: restoredDatabase, uploadsPath: restoredPhotos }), /Schema histórico ou futuro incompatível/);
      const result = legacyWorker(`const { restoreBackupToTargets } = await import('./src/database/restoreBackup.ts');
        await restoreBackupToTargets(${JSON.stringify(backupPath)},${JSON.stringify({ databasePath: restoredDatabase, uploadsPath: restoredPhotos })});
        console.log(JSON.stringify({restored:true}));`);
      assert.equal(result.restored, true);
      const restored = client(restoredDatabase);
      assert.deepEqual(await contents(restored), legacyContents);
      const migrations = await restored.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name');
      assert.deepEqual(migrations.map(row => row.migration_name), priorMigrations);
      await assert.rejects(restored.saleReversal.count(), /does not exist/);
      assert.deepEqual(await readFile(path.join(restoredPhotos, 'synthetic.png')), png);
      assert.equal(createHash('sha256').update(await readFile(path.join(backupPath, 'database.sqlite'))).digest('hex'), backupHash);
    });
  } finally {
    t.mock.timers.reset();
    await current?.prisma.$disconnect();
    await Promise.all(clients.map(value => value.$disconnect()));
    for (const link of dependencyLinks) await unlink(link);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
