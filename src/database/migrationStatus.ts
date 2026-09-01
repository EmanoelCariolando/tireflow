import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from '../config/appPaths.js';
import { prisma } from './prisma.js';

const MIGRATIONS_DIRECTORY = path.join(PROJECT_ROOT, 'prisma', 'migrations');

interface AppliedMigrationRow {
  migration_name: string;
}

export function findPendingMigrations(
  availableMigrations: readonly string[],
  appliedMigrations: readonly string[]
): string[] {
  const applied = new Set(appliedMigrations);
  return [...new Set(availableMigrations)].sort().filter((migration) => !applied.has(migration));
}

export async function assertDatabaseMigrationsApplied(): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true });
  const availableMigrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (availableMigrations.length === 0) {
    throw new Error(`Nenhuma migração foi encontrada em ${MIGRATIONS_DIRECTORY}.`);
  }

  let appliedMigrations: AppliedMigrationRow[];
  try {
    appliedMigrations = await prisma.$queryRawUnsafe<AppliedMigrationRow[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    );
  } catch (cause) {
    throw new Error(
      'Não foi possível conferir o histórico de migrações do banco. Execute npm run prisma:migrate:deploy antes de iniciar o TireFlow.',
      { cause }
    );
  }

  const pendingMigrations = findPendingMigrations(
    availableMigrations,
    appliedMigrations.map((migration) => migration.migration_name)
  );

  if (pendingMigrations.length > 0) {
    throw new Error(
      `Banco de dados desatualizado. Migrações pendentes: ${pendingMigrations.join(', ')}. Execute npm run prisma:migrate:deploy antes de iniciar o TireFlow.`
    );
  }
}
