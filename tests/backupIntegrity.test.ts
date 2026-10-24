import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

test('backup integrity and retention use only isolated files and databases', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tireflow-backup-integrity-'));
  const sourceDatabase = path.join(root, 'source.sqlite');
  await fs.writeFile(sourceDatabase, '');
  process.env.DATABASE_URL = `file:${sourceDatabase.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { createBackup } = await import('../src/database/backup.js');
  const { prisma } = await import('../src/database/prisma.js');
  const { default: env } = await import('../src/config/env.js');
  const { PRODUCT_UPLOAD_DIRECTORY } = await import('../src/config/appPaths.js');
  const { recoverBackupRestore, restoreBackupToTargets } = await import('../src/database/restoreBackup.js');
  const { resolveSqliteDatabasePath } = await import('../src/database/databasePath.js');
  const { replaceProductPhoto } = await import('../src/services/productPhotoService.js');
  let nextId = 0;
  const fixture = async () => {
    const directory = path.join(root, String(++nextId));
    await fs.mkdir(directory);
    const product = await prisma.product.create({ data: { reference: '175/70 R14', description: `BACKUP ${nextId}`,
      stock: 5, cashPrice: 100, creditPrice: 105.8 } });
    const photo = await replaceProductPhoto(product.id, 'image/png', png.toString('base64'));
    const backup = (day: number, retention = 99) => createBackup({ backupRoot: directory, retention, now: new Date(2026, 6, day, 8) });
    const expected = (day: number) => path.join(directory, `2026-07-${String(day).padStart(2, '0')}_08-00-00`);
    return { directory, product, photo, backup, expected };
  };
  const assertRestorable = async (backup: string) => {
    const target = path.join(root, `restored-${++nextId}`);
    await restoreBackupToTargets(backup, { databasePath: path.join(target, 'database.sqlite'), uploadsPath: path.join(target, 'uploads', 'products') });
  };
  const worker = (mode: string, directory: string, day: number, retention = 2) => spawnSync(process.execPath,
    ['--import', 'tsx', 'tests/backupCrashWorker.ts', mode, directory, String(day), String(retention)],
    { env: process.env, encoding: 'utf8', timeout: 20000 });
  try {
    await t.test('a dated directory with unexpected nested contents is preserved', async () => {
      const f = await fixture();
      const previous = await f.backup(18);
      await fs.rm(path.join(previous, '.env.example'));
      await fs.mkdir(path.join(previous, '.env.example'));
      await fs.writeFile(path.join(previous, '.env.example', 'keep.txt'), 'not a backup file');
      await f.backup(19, 1);
      assert.equal(await fs.readFile(path.join(previous, '.env.example', 'keep.txt'), 'utf8'), 'not a backup file');
    });
    await t.test('two real processes cannot create backups of the same database concurrently', async () => {
      const f = await fixture();
      const previous = await f.backup(18);
      const holder = spawn(process.execPath, ['--import', 'tsx', 'tests/backupCrashWorker.ts', 'hold', f.directory, '19'], {
        env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
      });
      try {
        let output = '';
        while (!output.includes('BACKUP_LOCK_HELD')) {
          const [chunk] = await once(holder.stdout, 'data', { signal: AbortSignal.timeout(15000) });
          output += String(chunk);
        }
        const result = worker('create', f.directory, 19);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /bloqueio|uso/);
      } finally {
        if (holder.exitCode === null) {
          const exited = once(holder, 'exit');
          holder.stdin.end('release');
          await exited;
        }
      }
      await assertRestorable(previous);
      assert.equal(worker('create', f.directory, 19).status, 0);
      await assertRestorable(f.expected(19));
    });
    for (const mode of ['snapshot', 'partial-manifest', 'published', 'retention']) {
      await t.test(`process restart after ${mode} preserves usable backups`, async () => {
        const f = await fixture();
        const previous = await f.backup(18);
        if (mode === 'retention') await f.backup(19);
        const day = mode === 'retention' ? 20 : 19;
        const result = worker(mode, f.directory, day);
        assert.equal(result.status, 91, result.stderr);
        await recoverBackupRestore({ databasePath: resolveSqliteDatabasePath(), uploadsPath: PRODUCT_UPLOAD_DIRECTORY });
        if (mode === 'retention') {
          await assertRestorable(f.expected(19));
          await assertRestorable(f.expected(20));
        } else await assertRestorable(previous);
        if (mode === 'published') await assertRestorable(f.expected(day));
        if (mode === 'partial-manifest') await assert.rejects(assertRestorable(f.expected(day)));
        const next = await f.backup(21, 2);
        await assertRestorable(next);
        if (mode === 'snapshot' || mode === 'partial-manifest') await assertRestorable(previous);
      });
    }
    for (const code of ['EACCES', 'ENOSPC']) {
      await t.test(`retention ${code} cannot remove the new verified backup`, async () => {
        const f = await fixture();
        const previous = await f.backup(19);
        const remove = fs.rm;
        const mocked = t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
          if (path.resolve(String(args[0])) === previous) throw Object.assign(new Error(code), { code });
          return remove(...args);
        });
        syncBuiltinESMExports();
        try { await assert.rejects(f.backup(20, 1)); }
        finally { mocked.mock.restore(); syncBuiltinESMExports(); }
        await assertRestorable(f.expected(20));
        await assertRestorable(previous);
      });
    }
    await t.test('partial expiry deletion still preserves the new and retained verified backups', async () => {
      const f = await fixture();
      const expired = await f.backup(18);
      const kept = await f.backup(19);
      const remove = fs.rm;
      const mocked = t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
        if (path.resolve(String(args[0])) === expired) {
          await remove(path.join(expired, 'database.sqlite'));
          throw Object.assign(new Error('Partial expiry failure'), { code: 'EACCES' });
        }
        return remove(...args);
      });
      syncBuiltinESMExports();
      try { await assert.rejects(f.backup(20, 2)); }
      finally { mocked.mock.restore(); syncBuiltinESMExports(); }
      await assertRestorable(f.expected(20));
      await assertRestorable(kept);
    });
    await t.test('clock reversal cannot expire the backup that was just created', async () => {
      const f = await fixture();
      await f.backup(20);
      const result = await f.backup(19, 1);
      assert.equal(result, f.expected(19));
      await assertRestorable(result);
    });
    await t.test('another branch and an unrecognized dated directory are preserved', async () => {
      const f = await fixture();
      const foreign = await f.backup(18);
      const manifestPath = path.join(foreign, 'backup-manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      const changed = JSON.stringify({ ...manifest, branchName: 'OTHER BRANCH' });
      await fs.writeFile(manifestPath, changed);
      const unknown = f.expected(19);
      await fs.mkdir(unknown);
      await fs.writeFile(path.join(unknown, 'keep.txt'), 'unrecognized data');
      const result = await f.backup(20, 1);
      assert.equal(await fs.readFile(manifestPath, 'utf8'), changed);
      assert.equal(await fs.readFile(path.join(unknown, 'keep.txt'), 'utf8'), 'unrecognized data');
      const branch = env.branchName;
      env.branchName = 'OTHER BRANCH';
      try { await assertRestorable(foreign); } finally { env.branchName = branch; }
      await assertRestorable(result);
    });
    await t.test('a corrupt recent snapshot cannot evict an older valid backup from the retained set', async () => {
      const f = await fixture();
      const valid = await f.backup(18);
      const corrupt = await f.backup(19);
      await fs.writeFile(path.join(corrupt, 'database.sqlite'), 'corrupt snapshot');
      await f.backup(20, 2);
      assert.equal(await fs.readFile(path.join(corrupt, 'database.sqlite'), 'utf8'), 'corrupt snapshot');
      await assertRestorable(valid);
    });
    for (const timing of ['before-copy', 'after-copy'] as const) {
      await t.test(`photo replacement ${timing} never publishes a broken snapshot`, async () => {
        const f = await fixture();
        const previous = await f.backup(18);
        const copy = fs.cp;
        const mocked = t.mock.method(fs, 'cp', async (...args: Parameters<typeof fs.cp>) => {
          if (path.resolve(String(args[0])) !== PRODUCT_UPLOAD_DIRECTORY) return copy(...args);
          if (timing === 'before-copy') await replaceProductPhoto(f.product.id, 'image/png', Buffer.concat([png, Buffer.from([2])]).toString('base64'));
          await copy(...args);
          if (timing === 'after-copy') await replaceProductPhoto(f.product.id, 'image/png', Buffer.concat([png, Buffer.from([3])]).toString('base64'));
        });
        syncBuiltinESMExports();
        try {
          if (timing === 'before-copy') await assert.rejects(f.backup(19, 1));
          else await f.backup(19, 2);
        } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
        await assertRestorable(previous);
        if (timing === 'after-copy') {
          await assertRestorable(f.expected(19));
          assert.deepEqual(await fs.readFile(path.join(f.expected(19), f.photo.imagePath)), png);
        } else await assert.rejects(fs.stat(path.join(f.expected(19), 'backup-manifest.json')), { code: 'ENOENT' });
      });
    }
    await t.test('failed manifest publication leaves earlier backups restorable', async () => {
      const f = await fixture();
      const previous = await f.backup(18);
      const write = fs.writeFile;
      const mocked = t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
        if (path.resolve(String(args[0])) === path.join(f.expected(19), 'backup-manifest.json')) throw Object.assign(new Error('Manifest permission'), { code: 'EACCES' });
        return write(...args);
      });
      syncBuiltinESMExports();
      try { await assert.rejects(f.backup(19, 1), { code: 'EACCES' }); }
      finally { mocked.mock.restore(); syncBuiltinESMExports(); }
      await assertRestorable(previous);
      await assert.rejects(fs.stat(f.expected(19)), { code: 'ENOENT' });
    });
  } finally {
    await prisma.$disconnect();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
