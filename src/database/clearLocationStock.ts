import env from '../config/env.js';
import { normalizeSingleStockLocation, normalizeStockLocation } from '../utils/stockLocation.js';
import { createBackup } from './backup.js';
import { disconnectPrisma, prisma } from './prisma.js';

interface ProductToClear {
  id: string;
  reference: string;
  description: string;
  stock: number;
  stockLocation: string | null;
}

function printProducts(products: ProductToClear[]): void {
  for (const product of products.slice(0, 50)) {
    console.log(
      `- ${product.reference} - ${product.description}: ${product.stock} -> 0`
    );
  }

  if (products.length > 50) {
    console.log(`... ${products.length - 50} outros produtos omitidos.`);
  }
}

async function main(): Promise<void> {
  if (!/\bMONTEIRO\b|\bMTR\b/i.test(env.branchName)) {
    throw new Error('Operação cancelada: BRANCH_NAME não corresponde a Monteiro/MTR.');
  }

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const locationArgument = args.find((argument) => argument !== '--apply');
  const location = normalizeSingleStockLocation(locationArgument);

  if (!location) {
    throw new Error('Informe um local válido. Exemplo: npm run clear:location-stock -- CG');
  }

  const products = (await prisma.product.findMany({
    where: { stock: { gt: 0 } },
    select: {
      id: true,
      reference: true,
      description: true,
      stock: true,
      stockLocation: true,
    },
    orderBy: [{ reference: 'asc' }, { description: 'asc' }],
  })).filter((product) => normalizeStockLocation(product.stockLocation) === location);
  const totalUnits = products.reduce((total, product) => total + product.stock, 0);

  console.log(`Filial: ${env.branchName}`);
  console.log(`Local exclusivo selecionado: ${location}`);
  console.log(`Produtos com estoque a zerar: ${products.length}`);
  console.log(`Unidades a zerar: ${totalUnits}`);
  printProducts(products);

  if (!apply) {
    console.log('\nConferência concluída. Nenhuma alteração foi feita.');
    console.log(`Para aplicar, execute: npm run clear:location-stock -- ${location} --apply`);
    return;
  }

  if (products.length === 0) {
    console.log('\nNenhuma alteração necessária.');
    return;
  }

  const backupPath = await createBackup();
  console.log(`[BACKUP] Backup concluído e verificado: ${backupPath}`);

  await prisma.$transaction(async (tx) => {
    for (const product of products) {
      const update = await tx.product.updateMany({
        where: {
          id: product.id,
          stock: product.stock,
          stockLocation: product.stockLocation,
        },
        data: { stock: 0 },
      });

      if (update.count !== 1) {
        throw new Error(
          `O produto ${product.reference} - ${product.description} mudou durante a operação.`
        );
      }
    }
  });

  const remainingUnits = await prisma.product.aggregate({
    where: {
      id: { in: products.map((product) => product.id) },
    },
    _sum: { stock: true },
  });

  if ((remainingUnits._sum.stock ?? 0) !== 0) {
    throw new Error('A verificação final encontrou estoque restante; confira o backup e o banco.');
  }

  console.log(`\nEstoque zerado com sucesso: ${products.length} produtos, ${totalUnits} unidades.`);
  console.log('Produtos de outros locais e todos os demais dados foram preservados.');
}

main()
  .catch((error: unknown) => {
    console.error('Erro ao zerar estoque por local:', error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
