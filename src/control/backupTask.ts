import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createBackup } from '../database/backup.js';
import { assertSafePath, inspectBackup, validateStagedDatabase } from '../database/backupValidation.js';
import { disconnectPrisma } from '../database/prisma.js';
import env from '../config/env.js';
import { BACKUP_DIRECTORY } from '../config/appPaths.js';
import type { BackupStatus } from './operations.js';

// This entry point runs in its own process; the HTTP server never imports Prisma or bot configuration.
async function main(): Promise<BackupStatus> {
  const action = process.argv[2];
  if (!['create', 'inspect'].includes(action ?? '') || process.argv.length !== 3) throw new Error('Invalid backup action');
  const backupRoot = path.resolve(env.backupRoot || BACKUP_DIRECTORY);
  if (action === 'create') {
    // Keep the worker protocol separate from the existing mechanism's diagnostics.
    console.log = () => undefined;
    console.warn = () => undefined;
    const created = await createBackup();
    const manifest = JSON.parse(await readFile(path.join(created, 'backup-manifest.json'), 'utf8')) as { createdAt: string; productPhotoFiles: number };
    return { createdAt: manifest.createdAt, verifiedAt: new Date().toISOString(), verification: 'verified', photoFiles: manifest.productPhotoFiles };
  }
  let names: string[];
  try { names = (await readdir(backupRoot)).filter(name => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(name)).sort(); }
  catch { return { createdAt: null, verifiedAt: null, verification: 'unavailable', photoFiles: null }; }
  const latest = names.at(-1);
  if (!latest) return { createdAt: null, verifiedAt: null, verification: 'unavailable', photoFiles: null };
  let temporary: string | undefined;
  try {
    const backup = path.join(backupRoot, latest);
    const manifest = await inspectBackup(backup, env.branchName);
    temporary = await mkdtemp(path.join(os.tmpdir(), 'tireflow-control-verify-'));
    const database = path.join(temporary, 'database.sqlite');
    await cp(path.join(backup, 'database.sqlite'), database, { force: false, errorOnExist: true });
    await validateStagedDatabase(database, path.join(backup, 'uploads', 'products'));
    return { createdAt: manifest.createdAt, verifiedAt: new Date().toISOString(), verification: 'verified', photoFiles: manifest.productPhotoFiles };
  } catch { return { createdAt: null, verifiedAt: new Date().toISOString(), verification: 'failed', photoFiles: null }; }
  finally {
    if (temporary && path.dirname(temporary) === path.resolve(os.tmpdir())) {
      await assertSafePath(temporary);
      await rm(temporary, { recursive: true, force: false });
    }
  }
}

main().then(value => process.stdout.write(JSON.stringify(value))).catch(() => {
  process.stderr.write('Backup operation failed.');
  process.exitCode = 1;
}).finally(disconnectPrisma);
