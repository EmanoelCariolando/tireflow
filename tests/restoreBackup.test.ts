import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs/promises';
import env from '../src/config/env.js';
import { restoreBackupToTargets, recoverBackupRestore } from '../src/database/restoreBackup.js';
import { acquireDatabaseMaintenanceLock, acquireBackupLock, assertNoIncompleteRestore, exists } from '../src/database/maintenanceLock.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('restore validates disposable backups before touching the previous state', async t => {
  assert.equal(process.env.NODE_ENV, 'test', 'Use the isolated npm test runner.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-restore-'));
  const template = path.join(root, 'template.sqlite');
  await writeFile(template, '');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${template.replaceAll('\\', '/')}` }, stdio: 'pipe',
  });
  let nextId = 0;
  const fixture = async () => {
    const directory = path.join(root, String(++nextId));
    const backup = path.join(directory, 'backup');
    const uploads = path.join(backup, 'uploads', 'products');
    const targets = { databasePath: path.join(directory, 'live', 'database.sqlite'),
      uploadsPath: path.join(directory, 'live', 'uploads', 'products') };
    await mkdir(uploads, { recursive: true });
    await mkdir(targets.uploadsPath, { recursive: true });
    await cp(template, path.join(backup, 'database.sqlite'));
    await cp(template, targets.databasePath);
    await writeFile(path.join(targets.uploadsPath, 'previous.png'), png);
    const manifest = { version: 1, branchName: env.branchName, createdAt: new Date().toISOString(),
      databaseFile: 'database.sqlite', uploadsDirectory: 'uploads/products', productPhotoFiles: 0 };
    await writeFile(path.join(backup, 'backup-manifest.json'), JSON.stringify(manifest));
    const previous = await readFile(targets.databasePath);
    const assertPrevious = async () => {
      assert.deepEqual(await readFile(targets.databasePath), previous);
      assert.deepEqual(await readFile(path.join(targets.uploadsPath, 'previous.png')), png);
    };
    return { directory, backup, uploads, targets, manifest, assertPrevious };
  };
  const withImage = async (backup: string, imagePath: string) => {
    const client = new PrismaClient({ datasourceUrl: `file:${path.join(backup, 'database.sqlite').replaceAll('\\', '/')}` });
    try {
      await client.product.create({ data: { reference: '175/70 R14', description: 'RESTORE TEST',
        stock: 5, cashPrice: 100, creditPrice: 105.8, imagePath } });
    } finally { await client.$disconnect(); }
  };
  const worker = (mode: string, f: Awaited<ReturnType<typeof fixture>>, step: number) => spawnSync(process.execPath,
    ['--import', 'tsx', 'tests/restoreCrashWorker.ts', mode, f.backup, f.targets.databasePath, f.targets.uploadsPath, String(step)],
    { env: process.env, encoding: 'utf8', timeout: 20000 });
  try {
    await t.test('a normal app crash retains automatic restart without bypassing incomplete restoration', async () => {
      const f = await fixture();
      assert.equal(worker('app-lock', f, 0).status, 91);
      const release = await acquireDatabaseMaintenanceLock(f.targets.databasePath);
      await release();
      assert.equal(worker('restore', f, 5).status, 91);
      await assert.rejects(acquireDatabaseMaintenanceLock(f.targets.databasePath));
      await recoverBackupRestore(f.targets);
      await f.assertPrevious();
    });
    await t.test('uploads cannot occupy the reserved WAL filename even when absent', async () => {
      const f = await fixture();
      await assert.rejects(restoreBackupToTargets(f.backup, { ...f.targets, uploadsPath: `${f.targets.databasePath}-wal` }));
      await f.assertPrevious();
    });
    for (const name of ['.gitkeep', '.GITKEEP', '.gitkeep.']) {
    await t.test(`a placeholder file cannot satisfy a referenced product photo: ${name}`, async () => {
      const f = await fixture();
      await withImage(f.backup, `uploads/products/${name}`);
      await writeFile(path.join(f.uploads, '.gitkeep'), '');
      await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
      await f.assertPrevious();
    });
    }
    await t.test('a failed commit marker and failed rollback cannot permit startup', async () => {
      const f = await fixture();
      const open = fs.open;
      const mockedOpen = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (path.basename(String(args[0])) === 'committed') handle.sync = async () => { throw new Error('Commit sync failed'); };
        return handle;
      });
      const mockedCopy = t.mock.method(fs, 'copyFile', async () => { throw new Error('Rollback copy failed'); });
      try {
        await assert.rejects(restoreBackupToTargets(f.backup, f.targets), AggregateError);
        await assert.rejects(assertNoIncompleteRestore(f.targets.databasePath));
      } finally { mockedOpen.mock.restore(); mockedCopy.mock.restore(); }
      await recoverBackupRestore(f.targets);
      await f.assertPrevious();
    });
    for (const when of ['before', 'after']) {
      for (const step of [1, 2, 3, 4]) {
        await t.test(`rename error ${when} replacement ${step} rolls back automatically`, async () => {
          const f = await fixture();
          const rename = fs.rename;
          let count = 0;
          const mocked = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
            const fail = ++count === step;
            if (fail && when === 'before') throw new Error('Injected rename failure');
            await rename(...args);
            if (fail && when === 'after') throw new Error('Injected rename failure');
          });
          try { await assert.rejects(restoreBackupToTargets(f.backup, f.targets), /Injected rename failure/); }
          finally { mocked.mock.restore(); }
          await f.assertPrevious();
          await assertNoIncompleteRestore(f.targets.databasePath);
        });
      }
    }
    await t.test('failed preparation leaves the existing state intact', async () => {
      const f = await fixture();
      const makeDirectory = fs.mkdir;
      const mocked = t.mock.method(fs, 'mkdir', async (...args: Parameters<typeof fs.mkdir>) => {
        if (String(args[0]).startsWith(`${f.targets.uploadsPath}.restore-`) && !args[1]) {
          throw Object.assign(new Error('No permission for staging'), { code: 'EACCES' });
        }
        return makeDirectory(...args);
      });
      try { await assert.rejects(restoreBackupToTargets(f.backup, f.targets), { code: 'EACCES' }); }
      finally { mocked.mock.restore(); }
      await f.assertPrevious();
      await assertNoIncompleteRestore(f.targets.databasePath);
    });
    for (const step of [3, 4]) {
      await t.test(`recovery removes partial new destinations when none existed originally (${step})`, async () => {
        const f = await fixture();
        await rm(f.targets.databasePath);
        await rm(f.targets.uploadsPath, { recursive: true });
        assert.equal(worker('restore', f, step).status, 91);
        await recoverBackupRestore(f.targets);
        await recoverBackupRestore(f.targets);
        assert.equal(await exists(f.targets.databasePath), false);
        assert.equal(await exists(f.targets.uploadsPath), false);
      });
    }
    await t.test('recovery preserves a real committed WAL transaction from the previous database', async () => {
      const f = await fixture();
      assert.equal(worker('wal', f, 0).status, 91);
      const original = await Promise.all(['', '-wal', '-shm'].map(suffix => readFile(f.targets.databasePath + suffix)));
      assert.equal(worker('restore', f, 8).status, 91);
      await recoverBackupRestore(f.targets);
      for (const [index, suffix] of ['', '-wal', '-shm'].entries()) assert.deepEqual(await readFile(f.targets.databasePath + suffix), original[index]);
      const client = new PrismaClient({ datasourceUrl: `file:${f.targets.databasePath.replaceAll('\\', '/')}` });
      try { assert.equal((await client.product.findFirstOrThrow({ where: { description: 'WAL COMMIT' } })).stock, 77); }
      finally { await client.$disconnect(); }
    });
    await t.test('live or inaccessible lock owners are never evicted', async () => {
      const f = await fixture();
      const release = await acquireDatabaseMaintenanceLock(f.targets.databasePath);
      try {
        await assert.rejects(recoverBackupRestore(f.targets), /ativo/);
        const mocked = t.mock.method(process, 'kill', () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
        try { await assert.rejects(recoverBackupRestore(f.targets), { code: 'EPERM' }); }
        finally { mocked.mock.restore(); }
        assert.equal(await exists(`${f.targets.databasePath}.tireflow-lock`), true);
        await f.assertPrevious();
      } finally { await release(); }
    });
    await t.test('overlapping backup and destinations are rejected without copying', async () => {
      const f = await fixture();
      await assert.rejects(restoreBackupToTargets(f.backup, { ...f.targets, uploadsPath: f.backup }));
      await assert.rejects(restoreBackupToTargets(f.backup, { ...f.targets, databasePath: path.join(f.targets.uploadsPath, 'db.sqlite') }));
      await f.assertPrevious();
    });
    await t.test('malformed journal cannot be bypassed with a completed marker', async () => {
      const f = await fixture();
      const work = `${f.targets.databasePath}.restore`;
      await mkdir(work);
      await writeFile(path.join(work, 'state.json'), '{broken');
      await writeFile(path.join(work, 'committed'), '');
      await assert.rejects(assertNoIncompleteRestore(f.targets.databasePath));
      await assert.rejects(recoverBackupRestore(f.targets));
      await f.assertPrevious();
    });
    for (const absent of [false, true]) {
      await t.test(`failed replacement restores the original presence of destinations (absent=${absent})`, async () => {
        const f = await fixture();
        if (absent) { await rm(f.targets.databasePath); await rm(f.targets.uploadsPath, { recursive: true }); }
        const rename = fs.rename;
        let failed = false;
        const mocked = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
          if (String(args[0]).endsWith(`${path.sep}new`) && !failed) {
            failed = true;
            throw Object.assign(new Error('Simulated replace failure'), { code: 'EACCES' });
          }
          return rename(...args);
        });
        try { await assert.rejects(restoreBackupToTargets(f.backup, f.targets), { code: 'EACCES' }); }
        finally { mocked.mock.restore(); }
        if (absent) { assert.equal(await exists(f.targets.databasePath), false); assert.equal(await exists(f.targets.uploadsPath), false); }
        else await f.assertPrevious();
        await assertNoIncompleteRestore(f.targets.databasePath);
      });
    }
    await t.test('journal paths cannot redirect recovery to another directory', async () => {
      const f = await fixture();
      assert.equal(worker('restore', f, 5).status, 91);
      const statePath = path.join(`${f.targets.databasePath}.restore`, 'state.json');
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      const outside = path.join(f.directory, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'keep.txt'), 'keep');
      await writeFile(statePath, JSON.stringify({ ...state, uploadsPath: outside }));
      await assert.rejects(recoverBackupRestore(f.targets));
      assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
    });
    await t.test('a second interruption during recovery preserves the previous copy', async () => {
      const f = await fixture();
      assert.equal(worker('restore', f, 5).status, 91);
      assert.equal(worker('recover', f, 1).status, 91);
      await assert.rejects(recoverBackupRestore(f.targets));
      const state = JSON.parse(await readFile(path.join(`${f.targets.databasePath}.restore`, 'state.json'), 'utf8'));
      assert.deepEqual(await readFile(path.join(`${f.targets.uploadsPath}.restore-${state.id}`, 'previous', 'previous.png')), png);
      const guard = `${f.targets.databasePath}.restore-recovery`;
      // Operator procedure: all child processes exited, verify owner before clearing only the guard.
      const owner = JSON.parse(await readFile(path.join(guard, 'owner.json'), 'utf8'));
      assert.throws(() => process.kill(owner.pid, 0), { code: 'ESRCH' });
      await rm(path.join(guard, 'owner.json'));
      await fs.rmdir(guard);
      await recoverBackupRestore(f.targets);
      await f.assertPrevious();
    });
    await t.test('simultaneous recovery attempts cannot both acquire maintenance', async () => {
      const f = await fixture();
      assert.equal(worker('restore', f, 5).status, 91);
      const results = await Promise.allSettled([recoverBackupRestore(f.targets), recoverBackupRestore(f.targets)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      await f.assertPrevious();
    });
    await t.test('sidecars from the old database are preserved and recovered byte for byte', async () => {
      const f = await fixture();
      for (const suffix of ['-wal', '-shm', '-journal']) await writeFile(f.targets.databasePath + suffix, `old${suffix}`);
      assert.equal(worker('restore', f, 8).status, 91);
      await recoverBackupRestore(f.targets);
      await f.assertPrevious();
      for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(await readFile(f.targets.databasePath + suffix, 'utf8'), `old${suffix}`);
    });
    await t.test('the app and online backup coexist but exclude restoration', async () => {
      const f = await fixture();
      const releaseApp = await acquireDatabaseMaintenanceLock(f.targets.databasePath);
      const releaseBackup = await acquireBackupLock(f.targets.databasePath);
      try { await assert.rejects(restoreBackupToTargets(f.backup, f.targets)); await f.assertPrevious(); }
      finally { await releaseBackup(); await releaseApp(); }
      const releaseRestore = await acquireDatabaseMaintenanceLock(f.targets.databasePath, false, 'restore');
      try {
        await assert.rejects(acquireDatabaseMaintenanceLock(f.targets.databasePath));
        await assert.rejects(acquireBackupLock(f.targets.databasePath));
      } finally { await releaseRestore(); }
    });
    await t.test('starting the actual entry point refuses maintenance before startup checks', async () => {
      const f = await fixture();
      const release = await acquireDatabaseMaintenanceLock(f.targets.databasePath, false, 'restore');
      try {
        const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/restoreCrashWorker.ts', 'app',
          f.backup, f.targets.databasePath, f.targets.uploadsPath], {
          env: { ...process.env, DATABASE_URL: `file:${f.targets.databasePath.replaceAll('\\', '/')}`,
            BOSS_PRIVATE_NUMBER: '5500000000000', OWNER_PHONE: '5500000000001', DAILY_REPORT_TIME: '18:00',
            WHATSAPP_OFFICIAL_GROUP_ID: '120000000000000000@g.us', LOG_TO_CONSOLE: 'true',
            CHROME_EXECUTABLE_PATH: path.join(f.directory, 'missing-chrome.exe') },
          encoding: 'utf8', timeout: 15000,
        });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stdout + result.stderr, /Banco em uso|bloqueio/);
      } finally { await release(); }
    });
    for (const mutation of ['missing-manifest', 'missing-branch', 'old-schema', 'future-schema', 'failed-migration', 'checksum', 'wal', 'shm', 'journal'] as const) {
      await t.test(`incompatible historical backup is rejected intact: ${mutation}`, async () => {
        const f = await fixture();
        if (mutation === 'missing-manifest') await rm(path.join(f.backup, 'backup-manifest.json'));
        else if (mutation === 'missing-branch') await writeFile(path.join(f.backup, 'backup-manifest.json'), JSON.stringify({ ...f.manifest, branchName: undefined }));
        else if (['wal', 'shm', 'journal'].includes(mutation)) await writeFile(path.join(f.backup, `database.sqlite-${mutation}`), 'sidecar');
        else {
          const client = new PrismaClient({ datasourceUrl: `file:${path.join(f.backup, 'database.sqlite').replaceAll('\\', '/')}` });
          try {
            if (mutation === 'old-schema') await client.$executeRawUnsafe('DELETE FROM _prisma_migrations WHERE rowid = (SELECT MAX(rowid) FROM _prisma_migrations)');
            if (mutation === 'future-schema') await client.$executeRawUnsafe("UPDATE _prisma_migrations SET migration_name = 'future' WHERE rowid = (SELECT MAX(rowid) FROM _prisma_migrations)");
            if (mutation === 'failed-migration') await client.$executeRawUnsafe('UPDATE _prisma_migrations SET finished_at = NULL WHERE rowid = (SELECT MAX(rowid) FROM _prisma_migrations)');
            if (mutation === 'checksum') await client.$executeRawUnsafe("UPDATE _prisma_migrations SET checksum = 'invalid'");
          } finally { await client.$disconnect(); }
        }
        const original = await readFile(path.join(f.backup, 'database.sqlite'));
        await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
        await f.assertPrevious();
        assert.deepEqual(await readFile(path.join(f.backup, 'database.sqlite')), original);
      });
    }
    for (const step of [1, 2, 3, 4, 5, 6, 7]) {
      await t.test(`process interruption after critical operation ${step} remains recoverable`, async () => {
        const f = await fixture();
        await withImage(f.backup, 'uploads/products/product.png');
        await writeFile(path.join(f.uploads, 'product.png'), png);
        await writeFile(path.join(f.backup, 'backup-manifest.json'), JSON.stringify({ ...f.manifest, productPhotoFiles: 1 }));
        const result = worker('restore', f, step);
        assert.equal(result.status, 91, result.stderr);
        if (step < 7) await assert.rejects(assertNoIncompleteRestore(f.targets.databasePath));
        await recoverBackupRestore(f.targets);
        await recoverBackupRestore(f.targets);
        if (step < 7) await f.assertPrevious();
        else assert.deepEqual(await readFile(path.join(f.targets.uploadsPath, 'product.png')), png);
        await assertNoIncompleteRestore(f.targets.databasePath);
      });
    }
    await t.test('a required column missing despite complete migration history is incompatible', async () => {
      const f = await fixture();
      const client = new PrismaClient({ datasourceUrl: `file:${path.join(f.backup, 'database.sqlite').replaceAll('\\', '/')}` });
      try { await client.$executeRawUnsafe('ALTER TABLE movements DROP COLUMN totalValue'); }
      finally { await client.$disconnect(); }
      await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
      await f.assertPrevious();
    });
    for (const code of ['EACCES', 'ENOSPC']) {
      await t.test(`failed upload copy (${code}) leaves the previous database and photos intact`, async () => {
        const f = await fixture();
        await withImage(f.backup, 'uploads/products/product.png');
        await writeFile(path.join(f.uploads, 'product.png'), png);
        await writeFile(path.join(f.backup, 'backup-manifest.json'), JSON.stringify({ ...f.manifest, productPhotoFiles: 1 }));
        const original = fs.cp;
        const mocked = t.mock.method(fs, 'cp', async (...args: Parameters<typeof fs.cp>) => {
          if (path.resolve(String(args[0])) === f.uploads) throw Object.assign(new Error(code), { code });
          return original(...args);
        });
        try { await assert.rejects(restoreBackupToTargets(f.backup, f.targets), { code }); }
        finally { mocked.mock.restore(); }
        await f.assertPrevious();
      });
    }
    await t.test('a valid v1 backup restores referenced photos and the database together', async () => {
      const f = await fixture();
      await withImage(f.backup, 'uploads/products/product.png');
      await writeFile(path.join(f.uploads, 'product.png'), png);
      await writeFile(path.join(f.backup, 'backup-manifest.json'), JSON.stringify({ ...f.manifest, productPhotoFiles: 1 }));
      await restoreBackupToTargets(f.backup, f.targets);
      assert.deepEqual(await readFile(f.targets.databasePath), await readFile(path.join(f.backup, 'database.sqlite')));
      assert.deepEqual(await readFile(path.join(f.targets.uploadsPath, 'product.png')), png);
      await assert.rejects(readFile(path.join(f.targets.uploadsPath, 'previous.png')), { code: 'ENOENT' });
    });
    for (const corruption of ['bad-header', 'broken-page'] as const) {
      await t.test(`corrupt SQLite ${corruption} cannot replace the previous database`, async () => {
        const f = await fixture();
        const file = path.join(f.backup, 'database.sqlite');
        if (corruption === 'bad-header') await writeFile(file, 'not a database');
        else { const bytes = await readFile(file); bytes.fill(0xff, 100, 120); await writeFile(file, bytes); }
        await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
        await f.assertPrevious();
      });
    }
    await t.test('a backup from another branch cannot replace the previous state', async () => {
      const f = await fixture();
      await writeFile(path.join(f.backup, 'backup-manifest.json'), JSON.stringify({ ...f.manifest, branchName: 'OTHER BRANCH' }));
      await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
      await f.assertPrevious();
    });
    await t.test('a missing database leaves the previous state untouched', async () => {
      const f = await fixture();
      await rm(path.join(f.backup, 'database.sqlite'));
      await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
      await f.assertPrevious();
    });
    for (const imagePath of ['uploads/products/missing.png', '../../outside.png', 'C:\\outside.png']) {
      await t.test(`invalid referenced photo is rejected before replacement: ${imagePath}`, async () => {
        const f = await fixture();
        await withImage(f.backup, imagePath);
        await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
        await f.assertPrevious();
      });
    }
    await t.test('unexpected files in a backup are not silently installed', async () => {
      const f = await fixture();
      await writeFile(path.join(f.backup, 'uploads', 'products', 'unexpected.exe'), 'not an image');
      await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
      await f.assertPrevious();
    });
    await t.test('a linked uploads directory cannot read files outside the backup', async () => {
      const f = await fixture();
      const outside = path.join(f.directory, 'outside');
      await mkdir(outside);
      await writeFile(path.join(outside, 'external.png'), png);
      await rm(f.uploads, { recursive: true });
      await symlink(outside, f.uploads, 'junction');
      await assert.rejects(restoreBackupToTargets(f.backup, f.targets));
      await f.assertPrevious();
      await rm(f.uploads);
      assert.deepEqual(await readFile(path.join(outside, 'external.png')), png);
    });
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
