import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createBackup } from '../src/database/backup.js';
import { restoreBackupToTargets } from '../src/database/restoreBackup.js';

test('creates a verified backup and restores database and uploads together', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-backup-test-'));
  try {
    const backupPath = await createBackup({
      backupRoot: path.join(temporaryRoot, 'backups'),
      retention: 2,
      now: new Date('2026-07-19T08:00:00.000Z'),
    });
    const manifest = JSON.parse(
      await readFile(path.join(backupPath, 'backup-manifest.json'), 'utf8')
    ) as { branchName?: string; databaseFile?: string };
    assert.equal(manifest.databaseFile, 'database.sqlite');
    assert.ok(manifest.branchName);

    const restoredDatabase = path.join(temporaryRoot, 'restored', 'database.sqlite');
    const restoredUploads = path.join(temporaryRoot, 'restored', 'uploads', 'products');
    await restoreBackupToTargets(backupPath, {
      databasePath: restoredDatabase,
      uploadsPath: restoredUploads,
    });
    assert.ok((await stat(restoredDatabase)).size > 0);
    assert.equal(
      (await readFile(restoredDatabase)).subarray(0, 16).toString('utf8'),
      'SQLite format 3\u0000'
    );
    assert.equal((await stat(restoredUploads)).isDirectory(), true);
    const restoredClient = new PrismaClient({
      datasourceUrl: `file:${restoredDatabase.replace(/\\/g, '/')}`,
    });
    try {
      const integrityRows = await restoredClient.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'PRAGMA integrity_check'
      );
      assert.equal(Object.values(integrityRows[0] || {})[0], 'ok');
    } finally {
      await restoredClient.$disconnect();
    }
    const { prisma } = await import('../src/database/prisma.js');
    const product = await prisma.product.create({ data: { reference: '175/70 R14', description: 'MISSING PHOTO',
      stock: 1, cashPrice: 100, creditPrice: 105.8, imagePath: 'uploads/products/missing.png' } });
    try {
      await assert.rejects(createBackup({ backupRoot: path.join(temporaryRoot, 'backups'), retention: 1,
        now: new Date('2026-07-20T08:00:00.000Z') }));
      assert.ok((await stat(path.join(backupPath, 'backup-manifest.json'))).isFile());
    } finally { await prisma.product.delete({ where: { id: product.id } }); await prisma.$disconnect(); }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
