import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_UPLOAD_DIRECTORY } from '../config/appPaths.js';
import { disconnectPrisma } from './prisma.js';
import { resolveSqliteDatabasePath } from './databasePath.js';

interface RestoreTargets {
  databasePath: string;
  uploadsPath: string;
}

export async function restoreBackupToTargets(
  backupPathValue: string,
  targets: RestoreTargets
): Promise<void> {
  const backupPath = path.resolve(backupPathValue);
  const manifestPath = path.join(backupPath, 'backup-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    version?: unknown;
    databaseFile?: unknown;
    uploadsDirectory?: unknown;
  };
  if (
    manifest.version !== 1 ||
    manifest.databaseFile !== 'database.sqlite' ||
    manifest.uploadsDirectory !== 'uploads/products'
  ) {
    throw new Error('Manifesto de backup inválido ou incompatível.');
  }

  const sourceDatabase = path.join(backupPath, 'database.sqlite');
  const sourceUploads = path.join(backupPath, 'uploads', 'products');
  if (!(await stat(sourceDatabase)).isFile() || !(await stat(sourceUploads)).isDirectory()) {
    throw new Error('Backup incompleto: banco e uploads devem ser restaurados juntos.');
  }

  await mkdir(path.dirname(targets.databasePath), { recursive: true });
  await mkdir(path.dirname(targets.uploadsPath), { recursive: true });
  await cp(sourceDatabase, targets.databasePath, { force: true });
  await rm(targets.uploadsPath, { recursive: true, force: true });
  await cp(sourceUploads, targets.uploadsPath, { recursive: true, force: false });
}

async function main(): Promise<void> {
  const backupPath = process.argv[2];
  const confirmed = process.argv.includes('--confirm');
  if (!backupPath || !confirmed) {
    throw new Error('Uso: npm run restore -- <pasta-do-backup> --confirm. Pare o serviço NSSM antes.');
  }

  await disconnectPrisma();
  await restoreBackupToTargets(backupPath, {
    databasePath: resolveSqliteDatabasePath(),
    uploadsPath: PRODUCT_UPLOAD_DIRECTORY,
  });
  console.log('[RESTORE] Banco e fotos restaurados juntos. Execute o health check antes de iniciar o serviço NSSM.');
}

const directExecutionPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directExecutionPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error('[RESTORE] Falha na restauração:', error);
    process.exitCode = 1;
  });
}
