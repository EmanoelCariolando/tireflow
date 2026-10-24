import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from '../config/appPaths.js';
import { MAX_PRODUCT_IMAGE_BYTES, hasExpectedImageSignature } from '../services/productPhotoStorage.js';
import type { BackupManifest } from './backup.js';

export const DATABASE_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;
export interface RestoreState {
  version: 1;
  id: string;
  databasePath: string;
  uploadsPath: string;
  previousDatabaseFiles: string[];
  previousUploads: boolean;
}

export async function readRestoreState(databasePath: string, uploadsPath?: string): Promise<RestoreState> {
  const statePath = path.join(`${databasePath}.restore`, 'state.json');
  await assertSafePath(statePath);
  const state = JSON.parse(await readFile(statePath, 'utf8')) as RestoreState;
  if (!state || state.version !== 1 || typeof state.id !== 'string' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(state.id) ||
    state.databasePath !== databasePath || typeof state.uploadsPath !== 'string' || !path.isAbsolute(state.uploadsPath) ||
    (uploadsPath !== undefined && state.uploadsPath !== uploadsPath) ||
    typeof state.previousUploads !== 'boolean' || !Array.isArray(state.previousDatabaseFiles) ||
    state.previousDatabaseFiles.some(suffix => !DATABASE_SUFFIXES.includes(suffix as typeof DATABASE_SUFFIXES[number])) ||
    new Set(state.previousDatabaseFiles).size !== state.previousDatabaseFiles.length) {
    throw new Error('Journal de restauração inválido. Preserve os arquivos e solicite inspeção manual.');
  }
  return state;
}

export async function assertSafePath(filename: string): Promise<void> {
  const resolved = path.resolve(filename);
  let current = resolved;
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) {
        throw new Error(`Links não são permitidos na restauração: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function validatePhotoTree(directory: string): Promise<number> {
  await assertSafePath(directory);
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    await assertSafePath(filename);
    if (entry.isDirectory()) count += await validatePhotoTree(filename);
    else if (entry.isFile() && entry.name === '.gitkeep') continue;
    else if (entry.isFile()) {
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(entry.name).toLowerCase()];
      if (!mime || (await lstat(filename)).size > MAX_PRODUCT_IMAGE_BYTES ||
        !hasExpectedImageSignature(await readFile(filename), mime)) throw new Error('Foto inválida ou arquivo inesperado no backup.');
      count += 1;
    } else throw new Error('Arquivo especial não permitido no backup.');
  }
  return count;
}

export async function inspectBackup(backupPath: string, branchName: string): Promise<BackupManifest> {
  await assertSafePath(backupPath);
  const manifestPath = path.join(backupPath, 'backup-manifest.json');
  await assertSafePath(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<BackupManifest> | null;
  if (!manifest || manifest.version !== 1 || manifest.databaseFile !== 'database.sqlite' ||
    manifest.uploadsDirectory !== 'uploads/products' || manifest.branchName !== branchName ||
    !Number.isSafeInteger(manifest.productPhotoFiles) || Number(manifest.productPhotoFiles) < 0) {
    throw new Error('Backup sem identificação compatível da filial ou manifesto v1 completo. Compatibilize uma cópia separada.');
  }
  for (const entry of await readdir(backupPath)) {
    if (!['database.sqlite', 'backup-manifest.json', 'uploads', '.env.example'].includes(entry)) {
      throw new Error('Arquivo inesperado no backup (inclusive WAL/journal). Gere uma cópia SQLite consistente separada.');
    }
    await assertSafePath(path.join(backupPath, entry));
  }
  const uploads = path.join(backupPath, 'uploads');
  if ((await readdir(uploads)).some(name => name !== 'products')) throw new Error('Diretório inesperado no backup.');
  const sourceDatabase = path.join(backupPath, 'database.sqlite');
  const databaseInfo = await lstat(sourceDatabase);
  if (!databaseInfo.isFile() || databaseInfo.size === 0) throw new Error('Banco ausente ou vazio no backup.');
  const count = await validatePhotoTree(path.join(uploads, 'products'));
  if (count !== manifest.productPhotoFiles) throw new Error('Contagem de fotos diverge do manifesto.');
  return manifest as BackupManifest;
}

export async function validateStagedDatabase(databasePath: string, uploadsPath: string): Promise<void> {
  const client = new PrismaClient({ datasourceUrl: `file:${databasePath.replaceAll('\\', '/')}` });
  try {
    // This connection only opens the disposable staged copy, never the backup source.
    await client.$queryRawUnsafe('PRAGMA trusted_schema = OFF');
    await client.$queryRawUnsafe('PRAGMA journal_mode = DELETE');
    await client.$queryRawUnsafe('PRAGMA query_only = ON');
    const rows = await client.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('Integridade SQLite inválida.');
    const references = await client.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
    if (references.length !== 0) throw new Error('Referências SQLite inválidas.');
    const available = (await readdir(path.join(PROJECT_ROOT, 'prisma', 'migrations'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const applied = await client.$queryRawUnsafe<Array<{ migration_name: string; checksum: string; finished_at: unknown; rolled_back_at: unknown }>>(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const finished = applied.filter(row => row.finished_at !== null && row.rolled_back_at === null).map(row => row.migration_name).sort();
    if (applied.some(row => row.finished_at === null && row.rolled_back_at === null) ||
      JSON.stringify(available) !== JSON.stringify(finished)) {
      throw new Error('Schema histórico ou futuro incompatível. Compatibilize uma cópia separada antes de restaurar.');
    }
    for (const row of applied.filter(row => row.finished_at !== null && row.rolled_back_at === null)) {
      const sql = await readFile(path.join(PROJECT_ROOT, 'prisma', 'migrations', row.migration_name, 'migration.sql'), 'utf8');
      const lf = sql.replace(/\r\n/g, '\n');
      const checksums = [sql, lf, lf.replace(/\n/g, '\r\n')].map(text => createHash('sha256').update(text).digest('hex'));
      if (!checksums.includes(row.checksum)) throw new Error('Checksum de migração incompatível. Compatibilize uma cópia separada.');
    }
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    for (const model of Prisma.dmmf.datamodel.models) {
      const columns = model.fields.filter(field => field.kind !== 'object').map(field => `t.${quote(field.dbName ?? field.name)}`);
      await client.$queryRawUnsafe(`SELECT ${columns.join(', ')} FROM ${quote(model.dbName ?? model.name)} t LIMIT 0`);
    }
    const photos = await client.product.findMany({ select: { imagePath: true } });
    for (const { imagePath } of photos) {
      if (imagePath === null) continue;
      const normalized = imagePath.replaceAll('\\', '/');
      const parts = normalized.split('/');
      if (parts[0] !== 'uploads' || parts[1] !== 'products' || parts.length < 3 ||
        !/\.(?:jpe?g|png|webp)$/i.test(parts.at(-1) ?? '') ||
        parts.some(part => !part || part === '.' || part === '..' || /[:\0]/.test(part))) {
        throw new Error('Caminho de foto fora de uploads/products.');
      }
      const photoPath = path.join(uploadsPath, ...parts.slice(2));
      if (!(await lstat(photoPath)).isFile()) throw new Error('Foto referenciada ausente no backup.');
    }
  } finally { await client.$disconnect(); }
}
