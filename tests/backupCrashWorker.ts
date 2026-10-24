import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
const { createBackup } = await import('../src/database/backup.js');
const { disconnectPrisma } = await import('../src/database/prisma.js');
const { PRODUCT_UPLOAD_DIRECTORY } = await import('../src/config/appPaths.js');
const { acquireBackupLock } = await import('../src/database/maintenanceLock.js');
const { resolveSqliteDatabasePath } = await import('../src/database/databasePath.js');
const [mode, backupRoot, day, retention = '2'] = process.argv.slice(2);
if (!backupRoot || !day) throw new Error('Missing disposable test paths.');
if (mode === 'hold') {
  const release = await acquireBackupLock(resolveSqliteDatabasePath());
  console.log('BACKUP_LOCK_HELD');
  await new Promise(resolve => process.stdin.once('data', resolve));
  await release();
  process.stdin.pause();
} else {
  const copy = fs.cp;
  fs.cp = async (...args) => {
    if (mode === 'snapshot' && path.resolve(String(args[0])) === PRODUCT_UPLOAD_DIRECTORY) process.exit(91);
    await copy(...args);
  };
  const write = fs.writeFile;
  fs.writeFile = async (...args) => {
    if (path.basename(String(args[0])) === 'backup-manifest.json' && mode === 'partial-manifest') {
      await write(args[0], '{"version":1');
      process.exit(91);
    }
    await write(...args);
    if (path.basename(String(args[0])) === 'backup-manifest.json' && mode === 'published') process.exit(91);
  };
  const remove = fs.rm;
  fs.rm = async (...args) => {
    if (mode === 'retention' && path.resolve(String(args[0])) === path.join(backupRoot, '2026-07-18_08-00-00')) {
      await remove(path.join(String(args[0]), 'database.sqlite'));
      process.exit(91);
    }
    await remove(...args);
  };
  syncBuiltinESMExports();
  try { await createBackup({ backupRoot, now: new Date(2026, 6, Number(day), 8), retention: Number(retention) }); }
  catch (error) { console.error(error); process.exitCode = 1; }
  finally { await disconnectPrisma(); }
}
