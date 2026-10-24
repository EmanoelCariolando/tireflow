import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRODUCT_UPLOAD_DIRECTORY } from '../config/appPaths.js';
import env from '../config/env.js';
import { resolveSqliteDatabasePath } from './databasePath.js';
import { assertSafePath, containsPath, inspectBackup, validatePhotoTree, validateStagedDatabase,
  DATABASE_SUFFIXES, readRestoreState, type RestoreState } from './backupValidation.js';
import { acquireDatabaseMaintenanceLock, exists, removeDeadDatabaseLock } from './maintenanceLock.js';

interface RestoreTargets {
  databasePath: string;
  uploadsPath: string;
}

async function writeDurable(filename: string, value: string): Promise<void> {
  const handle = await fs.open(filename, 'wx');
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}

async function safeTree(directory: string): Promise<void> {
  await assertSafePath(directory);
  if (!await exists(directory)) return;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    await assertSafePath(filename);
    if (entry.isDirectory()) await safeTree(filename);
    else if (!entry.isFile()) throw new Error('Arquivo especial no destino ou na recuperação.');
  }
}

async function checkedTargets(targets: RestoreTargets, backupPath?: string): Promise<RestoreTargets> {
  const normalized = { databasePath: path.resolve(targets.databasePath), uploadsPath: path.resolve(targets.uploadsPath) };
  const { databasePath, uploadsPath } = normalized;
  const reserved = [...DATABASE_SUFFIXES.map(suffix => databasePath + suffix), `${databasePath}.restore`,
    `${databasePath}.restore-recovery`, `${databasePath}.tireflow-lock`, `${databasePath}.backup.tireflow-lock`];
  if (path.dirname(databasePath) === databasePath || path.dirname(uploadsPath) === uploadsPath ||
    reserved.some(filename => containsPath(uploadsPath, filename) || containsPath(filename, uploadsPath))) {
    throw new Error('Destinos de restauração sobrepostos ou inválidos.');
  }
  for (const filename of [databasePath, uploadsPath, `${databasePath}.restore`, `${databasePath}.restore-recovery`]) {
    await assertSafePath(filename);
    if (backupPath && (containsPath(backupPath, filename) || containsPath(filename, backupPath))) {
      throw new Error('Origem e destinos da restauração não podem se sobrepor.');
    }
  }
  await safeTree(uploadsPath);
  for (const suffix of DATABASE_SUFFIXES) {
    const filename = databasePath + suffix;
    await assertSafePath(filename);
    if (await exists(filename) && !(await fs.lstat(filename)).isFile()) throw new Error('Destino SQLite não é arquivo regular.');
  }
  return normalized;
}

async function rollback(targets: RestoreTargets, state: RestoreState): Promise<void> {
  const work = `${targets.databasePath}.restore`;
  const uploadWork = `${targets.uploadsPath}.restore-${state.id}`;
  await safeTree(work);
  await safeTree(uploadWork);
  if (!await exists(path.join(work, 'prepared'))) return;
  for (const suffix of DATABASE_SUFFIXES) {
    const previous = path.join(work, `previous.sqlite${suffix}`);
    const destination = targets.databasePath + suffix;
    await assertSafePath(destination);
    if (await exists(previous)) {
      await fs.rm(destination, { force: true });
      await fs.copyFile(previous, destination);
    } else if (!state.previousDatabaseFiles.includes(suffix)) {
      await fs.rm(destination, { force: true });
    } else if (!await exists(destination)) throw new Error('Arquivo anterior não foi localizado; recuperação interrompida.');
  }
  const previousUploads = path.join(uploadWork, 'previous');
  await safeTree(targets.uploadsPath);
  if (await exists(previousUploads)) {
    await fs.rm(targets.uploadsPath, { recursive: true, force: true });
    await fs.cp(previousUploads, targets.uploadsPath, { recursive: true, force: false, errorOnExist: true });
  } else if (!state.previousUploads) {
    await fs.rm(targets.uploadsPath, { recursive: true, force: true });
  } else if (!await exists(targets.uploadsPath)) throw new Error('Uploads anteriores não foram localizados.');
}

export async function restoreBackupToTargets(backupPathValue: string, targetsValue: RestoreTargets): Promise<void> {
  const backupPath = path.resolve(backupPathValue);
  const targets = await checkedTargets(targetsValue, backupPath);
  const release = await acquireDatabaseMaintenanceLock(targets.databasePath, false, 'restore');
  const work = `${targets.databasePath}.restore`;
  let state: RestoreState | undefined;
  try {
    const manifest = await inspectBackup(backupPath, env.branchName);
    if (await exists(work)) await fs.rename(work, `${work}.history-${randomUUID()}`);
    const previousDatabaseFiles: string[] = [];
    for (const suffix of DATABASE_SUFFIXES) if (await exists(targets.databasePath + suffix)) previousDatabaseFiles.push(suffix);
    state = { version: 1, id: randomUUID(), ...targets, previousDatabaseFiles, previousUploads: await exists(targets.uploadsPath) };
    await fs.mkdir(work);
    await writeDurable(path.join(work, 'state.json'), JSON.stringify(state));
    const uploadWork = `${targets.uploadsPath}.restore-${state.id}`;
    await assertSafePath(uploadWork);
    await fs.mkdir(path.dirname(uploadWork), { recursive: true });
    await fs.mkdir(uploadWork);
    const stagedDatabase = path.join(work, 'database.sqlite');
    const stagedUploads = path.join(uploadWork, 'new');
    await fs.cp(path.join(backupPath, 'database.sqlite'), stagedDatabase, { force: false, errorOnExist: true });
    await fs.cp(path.join(backupPath, 'uploads', 'products'), stagedUploads, { recursive: true, force: false, errorOnExist: true });
    await assertSafePath(stagedDatabase);
    if (await validatePhotoTree(stagedUploads) !== manifest.productPhotoFiles) throw new Error('Fotos copiadas divergem do manifesto.');
    await validateStagedDatabase(stagedDatabase, stagedUploads);
    await writeDurable(path.join(work, 'prepared'), '');
    for (const suffix of state.previousDatabaseFiles) {
      await fs.rename(targets.databasePath + suffix, path.join(work, `previous.sqlite${suffix}`));
    }
    if (state.previousUploads) await fs.rename(targets.uploadsPath, path.join(uploadWork, 'previous'));
    await fs.rename(stagedDatabase, targets.databasePath);
    await fs.rename(stagedUploads, targets.uploadsPath);
    await writeDurable(path.join(work, 'committed'), '');
    console.log(`[RESTORE] Estado anterior preservado em ${work} e ${uploadWork}.`);
  } catch (error) {
    if (state && await exists(path.join(work, 'state.json'))) {
      try {
        // A failed marker sync must not let startup accept a partially rolled-back pair.
        await fs.rm(path.join(work, 'committed'), { force: true });
        await rollback(targets, state);
        await writeDurable(path.join(work, 'rolled-back'), '');
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], `Restauração interrompida; preserve ${work} e execute --recover --confirm.`);
      }
    }
    throw error;
  } finally { await release(); }
}

export async function recoverBackupRestore(targetsValue: RestoreTargets): Promise<void> {
  const targets = await checkedTargets(targetsValue);
  const guard = `${targets.databasePath}.restore-recovery`;
  await fs.mkdir(guard);
  let release: (() => Promise<void>) | undefined;
  try {
    await writeDurable(path.join(guard, 'owner.json'), JSON.stringify({ pid: process.pid }));
    await removeDeadDatabaseLock(targets.databasePath);
    await removeDeadDatabaseLock(`${targets.databasePath}.backup`);
    release = await acquireDatabaseMaintenanceLock(targets.databasePath, true, 'restore');
    const work = `${targets.databasePath}.restore`;
    if (!await exists(work)) return;
    const state = await readRestoreState(targets.databasePath, targets.uploadsPath);
    if (await exists(path.join(work, 'committed')) || await exists(path.join(work, 'rolled-back'))) return;
    await rollback(targets, state);
    await writeDurable(path.join(work, 'rolled-back'), '');
  } finally {
    if (release) await release();
    await fs.unlink(path.join(guard, 'owner.json'));
    await fs.rmdir(guard);
  }
}

async function main(): Promise<void> {
  const targets = { databasePath: resolveSqliteDatabasePath(), uploadsPath: PRODUCT_UPLOAD_DIRECTORY };
  if (!process.argv.includes('--confirm')) throw new Error('Use --confirm com o serviço e tarefas parados.');
  if (process.argv.includes('--recover')) {
    await recoverBackupRestore(targets);
    console.log('[RESTORE] Recuperação verificada. Confira o estado antes de iniciar o serviço.');
  } else {
    const backupPath = process.argv[2];
    if (!backupPath || backupPath.startsWith('--')) throw new Error('Uso: npm run restore -- <pasta-do-backup> --confirm.');
    await restoreBackupToTargets(backupPath, targets);
    console.log('[RESTORE] Banco e fotos restaurados. Execute o health check antes de iniciar o serviço.');
  }
}

const directExecutionPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directExecutionPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error('[RESTORE] Falha na restauração:', error);
    process.exitCode = 1;
  });
}
