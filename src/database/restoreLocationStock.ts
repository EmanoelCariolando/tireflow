import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import env from '../config/env.js';
import { normalizeSingleStockLocation, normalizeStockLocation } from '../utils/stockLocation.js';
import { createBackup } from './backup.js';
import { disconnectPrisma, prisma } from './prisma.js';

export interface ProductStockSnapshot {
  id: string;
  reference: string;
  description: string;
  stock: number;
  stockLocation: string | null;
}

export interface LocationStockRestoration {
  productId: string;
  reference: string;
  description: string;
  previousStock: number;
  previousLocation: string | null;
  stock: number;
  stockLocation: string;
}

export interface LocationStockConflict {
  reference: string;
  description: string;
  currentStock: number;
  backupStock: number;
  reason: string;
}

export interface LocationStockRestorationPlan {
  backupProducts: number;
  backupUnits: number;
  updates: LocationStockRestoration[];
  unchanged: number;
  missing: ProductStockSnapshot[];
  conflicts: LocationStockConflict[];
}

export function buildLocationStockRestorationPlan(
  backupProducts: ProductStockSnapshot[],
  currentProducts: ProductStockSnapshot[],
  location: string
): LocationStockRestorationPlan {
  const normalizedLocation = normalizeSingleStockLocation(location);
  if (!normalizedLocation) {
    throw new Error('Local inválido para restauração.');
  }

  const locationProducts = backupProducts.filter(
    (product) =>
      product.stock > 0 && normalizeStockLocation(product.stockLocation) === normalizedLocation
  );
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));
  const updates: LocationStockRestoration[] = [];
  const missing: ProductStockSnapshot[] = [];
  const conflicts: LocationStockConflict[] = [];
  let unchanged = 0;

  for (const backupProduct of locationProducts) {
    const currentProduct = currentById.get(backupProduct.id);
    if (!currentProduct) {
      missing.push(backupProduct);
      continue;
    }

    if (
      currentProduct.reference !== backupProduct.reference ||
      currentProduct.description !== backupProduct.description
    ) {
      conflicts.push({
        reference: backupProduct.reference,
        description: backupProduct.description,
        currentStock: currentProduct.stock,
        backupStock: backupProduct.stock,
        reason: 'o produto com o mesmo ID possui identificação diferente',
      });
      continue;
    }

    if (currentProduct.stock !== 0 && currentProduct.stock !== backupProduct.stock) {
      conflicts.push({
        reference: backupProduct.reference,
        description: backupProduct.description,
        currentStock: currentProduct.stock,
        backupStock: backupProduct.stock,
        reason: 'o estoque atual não está zerado e difere do backup',
      });
      continue;
    }

    if (
      currentProduct.stock === backupProduct.stock &&
      normalizeStockLocation(currentProduct.stockLocation) === normalizedLocation
    ) {
      unchanged++;
      continue;
    }

    updates.push({
      productId: currentProduct.id,
      reference: currentProduct.reference,
      description: currentProduct.description,
      previousStock: currentProduct.stock,
      previousLocation: currentProduct.stockLocation,
      stock: backupProduct.stock,
      stockLocation: normalizedLocation,
    });
  }

  return {
    backupProducts: locationProducts.length,
    backupUnits: locationProducts.reduce((total, product) => total + product.stock, 0),
    updates,
    unchanged,
    missing,
    conflicts,
  };
}

async function readBackupManifest(backupPath: string): Promise<{
  branchName: string;
  databasePath: string;
  createdAt: Date;
}> {
  const manifestPath = path.join(backupPath, 'backup-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    version?: unknown;
    branchName?: unknown;
    databaseFile?: unknown;
    createdAt?: unknown;
  };

  if (
    manifest.version !== 1 ||
    typeof manifest.branchName !== 'string' ||
    manifest.databaseFile !== 'database.sqlite' ||
    typeof manifest.createdAt !== 'string' ||
    Number.isNaN(Date.parse(manifest.createdAt))
  ) {
    throw new Error('Manifesto de backup inválido ou incompatível.');
  }

  const databasePath = path.join(backupPath, manifest.databaseFile);
  if (!(await stat(databasePath)).isFile()) {
    throw new Error('O banco database.sqlite não foi encontrado no backup.');
  }

  return {
    branchName: manifest.branchName,
    databasePath,
    createdAt: new Date(manifest.createdAt),
  };
}

function printProducts(plan: LocationStockRestorationPlan): void {
  for (const update of plan.updates.slice(0, 50)) {
    console.log(
      `- ${update.reference} - ${update.description}: estoque ${update.previousStock} -> ${update.stock}; ` +
        `local ${update.previousLocation ?? 'não cadastrado'} -> ${update.stockLocation}`
    );
  }
  if (plan.updates.length > 50) {
    console.log(`... ${plan.updates.length - 50} outros produtos omitidos.`);
  }
}

function printProblems(plan: LocationStockRestorationPlan): void {
  for (const product of plan.missing.slice(0, 20)) {
    console.log(`- AUSENTE: ${product.reference} - ${product.description}`);
  }
  for (const conflict of plan.conflicts.slice(0, 20)) {
    console.log(
      `- CONFLITO: ${conflict.reference} - ${conflict.description}: ` +
        `${conflict.reason} (${conflict.currentStock} atual, ${conflict.backupStock} no backup)`
    );
  }
}

async function printConflictMovements(
  plan: LocationStockRestorationPlan,
  since: Date
): Promise<void> {
  if (plan.conflicts.length === 0) {
    return;
  }

  console.log(`\nMovimentações dos conflitos desde ${since.toISOString()}:`);
  for (const conflict of plan.conflicts) {
    const product = await prisma.product.findFirst({
      where: {
        reference: conflict.reference,
        description: conflict.description,
      },
      select: {
        movements: {
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: {
            code: true,
            type: true,
            quantity: true,
            previousStock: true,
            newStock: true,
            supplier: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    console.log(`- ${conflict.reference} - ${conflict.description}`);
    if (!product || product.movements.length === 0) {
      console.log('  Nenhuma movimentação registrada após o backup.');
      continue;
    }
    for (const movement of product.movements) {
      console.log(
        `  ${movement.createdAt.toISOString()} | ${movement.code} | ${movement.type} | ` +
          `quantidade ${movement.quantity ?? '-'} | estoque ${movement.previousStock ?? '-'} -> ` +
          `${movement.newStock ?? '-'} | fornecedor ${movement.supplier ?? '-'} | ` +
          `motivo ${movement.reason ?? '-'}`
      );
    }
  }
}

async function main(): Promise<void> {
  if (!/\bMONTEIRO\b|\bMTR\b/i.test(env.branchName)) {
    throw new Error('Restauração cancelada: BRANCH_NAME não corresponde a Monteiro/MTR.');
  }

  const args = process.argv.slice(2);
  const applySafe = args.includes('--apply-safe');
  const apply = args.includes('--apply') || applySafe;
  const positionalArgs = args.filter(
    (argument) => argument !== '--apply' && argument !== '--apply-safe'
  );
  const backupArgument = positionalArgs[0];
  const location = normalizeSingleStockLocation(positionalArgs[1]);

  if (!backupArgument || !location) {
    throw new Error(
      'Uso: npm run restore:location-stock -- <pasta-do-backup> CG [--apply|--apply-safe]'
    );
  }

  const backupPath = path.resolve(backupArgument);
  const manifest = await readBackupManifest(backupPath);
  if (!/\bMONTEIRO\b|\bMTR\b/i.test(manifest.branchName)) {
    throw new Error('Restauração cancelada: o backup não pertence a Monteiro/MTR.');
  }

  const backupClient = new PrismaClient({
    datasourceUrl: `file:${manifest.databasePath.replace(/\\/g, '/')}`,
  });

  let backupProducts: ProductStockSnapshot[];
  try {
    const integrityRows = await backupClient.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'PRAGMA integrity_check'
    );
    if (Object.values(integrityRows[0] || {})[0] !== 'ok') {
      throw new Error('O banco do backup falhou na verificação de integridade.');
    }
    backupProducts = await backupClient.product.findMany({
      select: {
        id: true,
        reference: true,
        description: true,
        stock: true,
        stockLocation: true,
      },
    });
  } finally {
    await backupClient.$disconnect();
  }

  const backupLocationIds = backupProducts
    .filter(
      (product) => product.stock > 0 && normalizeStockLocation(product.stockLocation) === location
    )
    .map((product) => product.id);
  const currentProducts = await prisma.product.findMany({
    where: { id: { in: backupLocationIds } },
    select: {
      id: true,
      reference: true,
      description: true,
      stock: true,
      stockLocation: true,
    },
  });
  const plan = buildLocationStockRestorationPlan(backupProducts, currentProducts, location);
  const unitsToRestore = plan.updates.reduce(
    (total, update) => total + (update.stock - update.previousStock),
    0
  );

  console.log(`Filial atual: ${env.branchName}`);
  console.log(`Filial do backup: ${manifest.branchName}`);
  console.log(`Local a restaurar: ${location}`);
  console.log(`Produtos do local no backup: ${plan.backupProducts}`);
  console.log(`Unidades do local no backup: ${plan.backupUnits}`);
  console.log(`Produtos a restaurar: ${plan.updates.length}`);
  console.log(`Unidades a acrescentar: ${unitsToRestore}`);
  console.log(`Produtos já corretos: ${plan.unchanged}`);
  console.log(`Produtos ausentes: ${plan.missing.length}`);
  console.log(`Conflitos de estoque: ${plan.conflicts.length}`);
  printProducts(plan);
  printProblems(plan);
  await printConflictMovements(plan, manifest.createdAt);

  if (plan.backupProducts === 0) {
    throw new Error(`O backup não contém produtos com estoque positivo no local ${location}.`);
  }
  if (plan.missing.length > 0) {
    throw new Error(
      'Nenhuma alteração foi feita. Há produtos do backup ausentes no banco atual.'
    );
  }
  if (plan.conflicts.length > 0 && !applySafe) {
    throw new Error(
      'Nenhuma alteração foi feita. Há produtos movimentados após o backup. ' +
        'Use --apply-safe somente para restaurar os demais e preservar os conflitos.'
    );
  }

  if (!apply) {
    console.log('\nConferência concluída. Nenhuma alteração foi feita.');
    console.log('Revise a lista e execute novamente acrescentando --apply.');
    return;
  }

  if (plan.updates.length === 0) {
    console.log('\nNenhuma alteração necessária. Estoque e local já estão restaurados.');
    return;
  }

  if (applySafe && plan.conflicts.length > 0) {
    console.log(
      `\nRestauração segura: ${plan.conflicts.length} produto(s) conflitante(s) serão preservados sem alteração.`
    );
  }

  const safetyBackupPath = await createBackup({ retention: env.backupRetention + 1 });
  console.log(`[BACKUP] Estado anterior à restauração salvo em: ${safetyBackupPath}`);

  await prisma.$transaction(async (tx) => {
    for (const update of plan.updates) {
      const result = await tx.product.updateMany({
        where: {
          id: update.productId,
          stock: update.previousStock,
          stockLocation: update.previousLocation,
        },
        data: {
          stock: update.stock,
          stockLocation: update.stockLocation,
        },
      });
      if (result.count !== 1) {
        throw new Error(
          `O produto ${update.reference} - ${update.description} mudou durante a restauração.`
        );
      }
    }
  });

  const restoredProducts = await prisma.product.findMany({
    where: { id: { in: plan.updates.map((update) => update.productId) } },
    select: { id: true, stock: true, stockLocation: true },
  });
  const restoredById = new Map(restoredProducts.map((product) => [product.id, product]));
  const verificationFailed = plan.updates.some((update) => {
    const restored = restoredById.get(update.productId);
    return (
      !restored ||
      restored.stock !== update.stock ||
      normalizeStockLocation(restored.stockLocation) !== location
    );
  });
  if (verificationFailed) {
    throw new Error('A verificação final encontrou estoque ou local diferente do backup.');
  }

  console.log(
    `\nRestauração concluída: ${plan.updates.length} produtos e ${unitsToRestore} unidades no local ${location}.`
  );
  if (plan.conflicts.length > 0) {
    console.log(`${plan.conflicts.length} produto(s) com conflito permaneceram inalterados.`);
  }
  console.log('Vendas, entradas, preços, fotos e demais produtos foram preservados.');
}

const directExecutionPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directExecutionPath === fileURLToPath(import.meta.url)) {
  main()
    .catch((error: unknown) => {
      console.error('Erro ao restaurar estoque por local:', error);
      process.exitCode = 1;
    })
    .finally(disconnectPrisma);
}
