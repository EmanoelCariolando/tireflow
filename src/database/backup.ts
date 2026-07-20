import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';
import { BACKUP_DIRECTORY, PRODUCT_UPLOAD_DIRECTORY, PROJECT_ROOT } from '../config/appPaths.js';
import { prisma, disconnectPrisma } from './prisma.js';

export interface BackupManifest {
  version: 1;
  createdAt: string;
  branchName: string;
  databaseFile: string;
  uploadsDirectory: string;
  productPhotoFiles: number;
}

interface CreateBackupOptions {
  backupRoot?: string;
  retention?: number;
  now?: Date;
}

function formatBackupDirectoryName(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
}

async function countFiles(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) count += await countFiles(path.join(directory, entry.name));
    else if (entry.isFile() && entry.name !== '.gitkeep') count += 1;
  }
  return count;
}

function escapeSqliteLiteral(value: string): string {
  return value.replace(/\\/g, '/').replace(/'/g, "''");
}

async function pruneBackups(backupRoot: string, retention: number): Promise<void> {
  const directories = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const expiredDirectory of directories.slice(retention)) {
    const target = path.resolve(backupRoot, expiredDirectory);
    if (path.dirname(target) !== path.resolve(backupRoot)) {
      throw new Error('Caminho de retenção de backup inválido.');
    }
    await rm(target, { recursive: true, force: false });
  }
}

export async function createBackup(options: CreateBackupOptions = {}): Promise<string> {
  const backupRoot = path.resolve(options.backupRoot || BACKUP_DIRECTORY);
  const retention = options.retention || env.backupRetention;
  const now = options.now || new Date();
  const backupPath = path.join(backupRoot, formatBackupDirectoryName(now));
  const databaseBackupPath = path.join(backupPath, 'database.sqlite');
  const uploadsBackupPath = path.join(backupPath, 'uploads', 'products');

  await mkdir(backupRoot, { recursive: true });
  await mkdir(backupPath, { recursive: false });
  await mkdir(uploadsBackupPath, { recursive: true });

  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escapeSqliteLiteral(databaseBackupPath)}'`);
    await cp(PRODUCT_UPLOAD_DIRECTORY, uploadsBackupPath, { recursive: true, force: false });
    await cp(path.join(PROJECT_ROOT, '.env.example'), path.join(backupPath, '.env.example'), {
      force: false,
    });

    const databaseStats = await stat(databaseBackupPath);
    if (!databaseStats.isFile() || databaseStats.size === 0) {
      throw new Error('A cópia consistente do banco ficou vazia.');
    }

    const header = (await readFile(databaseBackupPath)).subarray(0, 16).toString('utf8');
    if (header !== 'SQLite format 3\u0000') {
      throw new Error('O arquivo gerado não possui um cabeçalho SQLite válido.');
    }

    const manifest: BackupManifest = {
      version: 1,
      createdAt: now.toISOString(),
      branchName: env.branchName,
      databaseFile: 'database.sqlite',
      uploadsDirectory: 'uploads/products',
      productPhotoFiles: await countFiles(uploadsBackupPath),
    };
    await writeFile(path.join(backupPath, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await pruneBackups(backupRoot, retention);
    return backupPath;
  } catch (error) {
    await rm(backupPath, { recursive: true, force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const backupPath = await createBackup();
  console.log(`[BACKUP] Backup concluído e verificado: ${backupPath}`);
}

const directExecutionPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directExecutionPath === fileURLToPath(import.meta.url)) {
  main()
    .catch((error: unknown) => {
      console.error('[BACKUP] Falha ao criar backup:', error);
      process.exitCode = 1;
    })
    .finally(disconnectPrisma);
}
