import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSafePath, readRestoreState } from './backupValidation.js';

export async function exists(filename: string): Promise<boolean> {
  try { await fs.lstat(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export async function assertNoIncompleteRestore(databasePath: string): Promise<void> {
  const work = `${databasePath}.restore`;
  await assertSafePath(work);
  if (await exists(work)) {
    await readRestoreState(databasePath);
    for (const name of ['committed', 'rolled-back']) {
      const marker = path.join(work, name);
      await assertSafePath(marker);
      if (await exists(marker)) {
        const info = await fs.lstat(marker);
        if (info.isFile() && info.size === 0) return;
        throw new Error('Marcador de restauração inválido.');
      }
    }
    throw new Error('Restauração incompleta. Mantenha o serviço parado e execute restore --recover --confirm.');
  }
}

export async function acquireDatabaseMaintenanceLock(databasePath: string, recovery = false, purpose: 'app' | 'restore' | 'backup' = 'app'): Promise<() => Promise<void>> {
  const lockPath = `${databasePath}.tireflow-lock`;
  await assertSafePath(lockPath);
  if (!recovery) {
    if (await exists(`${databasePath}.restore-recovery`)) throw new Error('Recuperação de restauração em andamento.');
    await assertNoIncompleteRestore(databasePath);
  }
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID(), purpose });
  let handle;
  try { handle = await fs.open(lockPath, 'wx'); }
  catch (cause) {
    if (!recovery && purpose === 'app' && (cause as NodeJS.ErrnoException).code === 'EEXIST') {
      return reclaimAbandonedAppLock(databasePath);
    }
    throw new Error('Banco em uso ou bloqueio anterior pendente. Pare o serviço; use --recover apenas após verificar os processos.', { cause });
  }
  try { await handle.writeFile(owner); await handle.sync(); } finally { await handle.close(); }
  const release = async () => {
    await assertSafePath(lockPath);
    if (await fs.readFile(lockPath, 'utf8') !== owner) throw new Error('Proprietário do bloqueio mudou; bloqueio preservado.');
    await fs.unlink(lockPath);
  };
  if (purpose === 'restore' && await exists(`${databasePath}.backup.tireflow-lock`)) {
    await release();
    throw new Error('Backup em andamento ou bloqueio de backup pendente.');
  }
  if (!recovery) {
    try {
      if (await exists(`${databasePath}.restore-recovery`)) throw new Error('Recuperação em andamento.');
      await assertNoIncompleteRestore(databasePath);
    } catch (error) { await release(); throw error; }
  }
  return release;
}

export async function withDatabaseMaintenanceLock<T>(databasePath: string, operation: () => Promise<T>): Promise<T> {
  const release = await acquireDatabaseMaintenanceLock(databasePath);
  try { return await operation(); }
  finally { await release(); }
}

export async function acquireBackupLock(databasePath: string): Promise<() => Promise<void>> {
  const release = await acquireDatabaseMaintenanceLock(`${databasePath}.backup`, false, 'backup');
  try {
    if (await exists(`${databasePath}.restore-recovery`)) throw new Error('Recuperação em andamento.');
    await assertNoIncompleteRestore(databasePath);
    const mainLock = `${databasePath}.tireflow-lock`;
    await assertSafePath(mainLock);
    if (await exists(mainLock)) {
      const owner = JSON.parse(await fs.readFile(mainLock, 'utf8')) as { purpose?: string };
      if (owner.purpose !== 'app') throw new Error('Restauração em andamento; backup bloqueado.');
    }
    return release;
  } catch (error) { await release(); throw error; }
}

async function reclaimAbandonedAppLock(databasePath: string): Promise<() => Promise<void>> {
  const guard = `${databasePath}.restore-recovery`;
  await assertSafePath(guard);
  await fs.mkdir(guard);
  try {
    await fs.writeFile(path.join(guard, 'owner.json'), JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    await assertNoIncompleteRestore(databasePath);
    const owner = JSON.parse(await fs.readFile(`${databasePath}.tireflow-lock`, 'utf8')) as { purpose?: string };
    if (owner?.purpose !== 'app') throw new Error('Banco em uso ou restauração anterior pendente; recuperação explícita necessária.');
    await removeDeadDatabaseLock(databasePath);
    // Keep the recovery guard until the new app lock has been written and synced.
    return await acquireDatabaseMaintenanceLock(databasePath, true, 'app');
  } finally {
    await fs.unlink(path.join(guard, 'owner.json'));
    await fs.rmdir(guard);
  }
}

export async function removeDeadDatabaseLock(databasePath: string): Promise<void> {
  const lockPath = `${databasePath}.tireflow-lock`;
  await assertSafePath(lockPath);
  if (!await exists(lockPath)) return;
  const owner = await fs.readFile(lockPath, 'utf8');
  const parsed = JSON.parse(owner) as { pid?: number; token?: string };
  if (!Number.isSafeInteger(parsed.pid) || Number(parsed.pid) <= 0 || typeof parsed.token !== 'string') {
    throw new Error('Bloqueio sem proprietário válido. Exige inspeção manual com todos os processos parados.');
  }
  try { process.kill(parsed.pid!, 0); throw new Error('Processo ainda ativo; recuperação bloqueada.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  if (await fs.readFile(lockPath, 'utf8') !== owner) throw new Error('Bloqueio mudou durante a recuperação.');
  await fs.unlink(lockPath);
}
