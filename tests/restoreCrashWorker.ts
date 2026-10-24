import fs from 'node:fs/promises';
import path from 'node:path';
import { restoreBackupToTargets, recoverBackupRestore } from '../src/database/restoreBackup.js';
import { acquireDatabaseMaintenanceLock } from '../src/database/maintenanceLock.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Disposable test environments only.');
const [mode, backup, databasePath, uploadsPath, step = '0'] = process.argv.slice(2);
if (!backup || !databasePath || !uploadsPath) throw new Error('Missing test paths.');
const targets = { databasePath, uploadsPath };
if (mode === 'app-lock') {
  await acquireDatabaseMaintenanceLock(databasePath);
  process.exit(91);
} else if (mode === 'app') {
  await import('../src/index.js');
} else if (mode === 'wal') {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasourceUrl: `file:${databasePath.replaceAll('\\', '/')}` });
  await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await client.product.create({ data: { reference: '175/70 R14', description: 'WAL COMMIT', stock: 77, cashPrice: 100, creditPrice: 105.8 } });
  process.exit(91);
} else {
  let count = 0;
  const crash = () => { if (++count === Number(step)) process.exit(91); };
  const rename = fs.rename;
  fs.rename = async (...args) => { await rename(...args); crash(); };
  const open = fs.open;
  fs.open = async (...args) => {
    const handle = await open(...args);
    if (['prepared', 'committed', 'state.json', 'rolled-back'].includes(path.basename(String(args[0])))) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); crash(); };
    }
    return handle;
  };
  if (mode === 'recover') {
    const copyFile = fs.copyFile;
    fs.copyFile = async (...args) => { await copyFile(...args); crash(); };
    await recoverBackupRestore(targets);
  } else await restoreBackupToTargets(backup, targets);
}
