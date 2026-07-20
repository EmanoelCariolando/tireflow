import path from 'node:path';
import env from '../config/env.js';
import { PROJECT_ROOT } from '../config/appPaths.js';

export function resolveSqliteDatabasePath(databaseUrl = env.databaseUrl): string {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('DATABASE_URL deve apontar para um arquivo SQLite usando file:.');
  }

  const rawPath = decodeURIComponent(databaseUrl.slice('file:'.length).split('?')[0] || '');
  if (!rawPath) throw new Error('DATABASE_URL não contém o caminho do banco SQLite.');

  return path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(PROJECT_ROOT, 'prisma', rawPath);
}
