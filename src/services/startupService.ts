import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { prisma } from '../database/prisma.js';
import { PRODUCT_UPLOAD_DIRECTORY } from '../config/appPaths.js';
import env, { assertRuntimeEnvironment } from '../config/env.js';

export async function runStartupChecks(): Promise<void> {
  assertRuntimeEnvironment();
  await mkdir(PRODUCT_UPLOAD_DIRECTORY, { recursive: true });
  await access(PRODUCT_UPLOAD_DIRECTORY, constants.R_OK | constants.W_OK);
  await mkdir(env.whatsappAuthDataPath, { recursive: true });
  await access(env.whatsappAuthDataPath, constants.R_OK | constants.W_OK);
  await access(env.chromeExecutablePath, constants.F_OK);

  await prisma.$queryRawUnsafe('SELECT 1');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 10000');
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  const integrityRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'PRAGMA integrity_check'
  );
  const integrityValue = integrityRows[0] ? Object.values(integrityRows[0])[0] : undefined;
  if (integrityValue !== 'ok') {
    throw new Error('Falha na verificação de integridade do banco SQLite. Restaure um backup válido.');
  }

  console.log('[STARTUP] Configuration, database integrity and uploads directory validated.');
}
