import fs from 'node:fs/promises';
import { ProductCategory, Prisma } from '@prisma/client';
import env from '../config/env.js';
import { disconnectPrisma, prisma } from './prisma.js';
import { withDatabaseMaintenanceLock } from './maintenanceLock.js';
import { resolveSqliteDatabasePath } from './databasePath.js';

const CATALOG_PATH = 'data/seed/congo_motorcycle_products_2026-10-15.csv';
const LEGACY_CATALOG_PATH = 'data/seed/congo_motorcycle_products_2026-06-09.csv';

interface MotorcycleCatalogRow {
  line: number;
  reference: string;
  description: string;
  cashPrice: string;
  creditPrice: string;
  stock: number;
  existingReference: string;
  existingDescription: string;
}

function normalizeKey(reference: string, description: string): string {
  return `${reference.trim().toUpperCase()}::${description.trim().toUpperCase()}`;
}

function parseMoney(value: string, line: number, column: string): string {
  if (!/^\d+\.\d{2}$/.test(value)) {
    throw new Error(`Linha ${line}: ${column} inválido.`);
  }
  return new Prisma.Decimal(value).toFixed(2);
}

async function readCatalog(): Promise<MotorcycleCatalogRow[]> {
  const content = await fs.readFile(CATALOG_PATH, 'utf8');
  const [header, ...lines] = content.trim().split(/\r?\n/);
  const expectedHeader =
    'reference,description,cash_price,credit_price,stock,existing_reference,existing_description';
  if (header !== expectedHeader) throw new Error('Cabeçalho inválido no catálogo de pneus de moto.');

  const rows = lines.map((line, index) => {
    const lineNumber = index + 2;
    const fields = line.split(',');
    if (fields.length !== 7) throw new Error(`Linha ${lineNumber}: quantidade de colunas inválida.`);
    const [
      reference,
      description,
      cashPrice,
      creditPrice,
      stockValue,
      existingReference,
      existingDescription,
    ] = fields as [string, string, string, string, string, string, string];
    if (!reference || !description || !/^\d+$/.test(stockValue)) {
      throw new Error(`Linha ${lineNumber}: referência, descrição ou estoque inválido.`);
    }
    if (Boolean(existingReference) !== Boolean(existingDescription)) {
      throw new Error(`Linha ${lineNumber}: identidade anterior incompleta.`);
    }
    return {
      line: lineNumber,
      reference,
      description,
      cashPrice: parseMoney(cashPrice, lineNumber, 'cash_price'),
      creditPrice: parseMoney(creditPrice, lineNumber, 'credit_price'),
      stock: Number(stockValue),
      existingReference,
      existingDescription,
    };
  });

  const keys = rows.map((row) => normalizeKey(row.reference, row.description));
  if (new Set(keys).size !== keys.length) throw new Error('O catálogo contém produtos duplicados.');
  return rows;
}

async function readLegacyKeys(): Promise<Set<string>> {
  const content = await fs.readFile(LEGACY_CATALOG_PATH, 'utf8');
  return new Set(
    content.trim().split(/\r?\n/).slice(1).map((line) => {
      const [reference = '', description = ''] = line.split(',');
      if (!reference || !description) throw new Error('Catálogo anterior de motos inválido.');
      return normalizeKey(reference, description);
    })
  );
}

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) {
    throw new Error('Importação exclusiva da filial Congo.');
  }

  const apply = process.argv.includes('--apply');
  const rows = await readCatalog();
  const legacyKeys = await readLegacyKeys();
  const products = await prisma.product.findMany();
  const productsByKey = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    const key = normalizeKey(product.reference, product.description);
    if (productsByKey.has(key)) {
      throw new Error(`Cadastro duplicado no banco: ${product.reference} - ${product.description}`);
    }
    productsByKey.set(key, product);
  }

  const targetIds = new Set<string>();
  const updates: Array<{ id: string; data: Prisma.ProductUpdateInput }> = [];
  const creates: Prisma.ProductCreateInput[] = [];

  for (const row of rows) {
    const exact = productsByKey.get(normalizeKey(row.reference, row.description));
    const alias = row.existingReference
      ? productsByKey.get(normalizeKey(row.existingReference, row.existingDescription))
      : undefined;
    if (exact && alias && exact.id !== alias.id) {
      throw new Error(`Linha ${row.line}: existem simultaneamente o cadastro novo e o anterior.`);
    }
    const product = exact ?? alias;
    if (!product) {
      creates.push({
        reference: row.reference,
        description: row.description,
        category: ProductCategory.MOTORCYCLE_TIRE,
        cashPrice: row.cashPrice,
        creditPrice: row.creditPrice,
        stock: row.stock,
      });
      continue;
    }
    if (targetIds.has(product.id)) {
      throw new Error(`Linha ${row.line}: o mesmo cadastro foi associado a mais de uma linha.`);
    }
    targetIds.add(product.id);

    const changed =
      product.reference !== row.reference ||
      product.description !== row.description ||
      product.category !== ProductCategory.MOTORCYCLE_TIRE ||
      product.cashPrice.toFixed(2) !== row.cashPrice ||
      product.creditPrice.toFixed(2) !== row.creditPrice ||
      product.stock !== row.stock;
    if (changed) {
      updates.push({
        id: product.id,
        data: {
          reference: row.reference,
          description: row.description,
          category: ProductCategory.MOTORCYCLE_TIRE,
          batteryBrand: null,
          cashPrice: row.cashPrice,
          creditPrice: row.creditPrice,
          stock: row.stock,
        },
      });
    }
  }

  const legacyCategoryUpdates = products.filter((product) =>
    !targetIds.has(product.id) &&
    legacyKeys.has(normalizeKey(product.reference, product.description)) &&
    product.category !== ProductCategory.MOTORCYCLE_TIRE
  );

  console.log(`Catálogo de 15/10/2026: ${rows.length} modelos.`);
  console.log(`Cadastros existentes a atualizar: ${updates.length}.`);
  console.log(`Cadastros novos a criar: ${creates.length}.`);
  console.log(`Cadastros anteriores a classificar como moto: ${legacyCategoryUpdates.length}.`);

  if (!apply) {
    console.log('Conferência concluída. Nenhuma alteração foi feita. Use --apply para gravar.');
    return;
  }

  await prisma.$transaction([
    ...updates.map((update) => prisma.product.update({ where: { id: update.id }, data: update.data })),
    ...legacyCategoryUpdates.map((product) => prisma.product.update({
      where: { id: product.id },
      data: { category: ProductCategory.MOTORCYCLE_TIRE, batteryBrand: null },
    })),
    ...creates.map((data) => prisma.product.create({ data })),
  ]);
  console.log('Importação de pneus de moto concluída com sucesso.');
}

const execute = () => main().finally(disconnectPrisma);
(process.argv.includes('--apply') ? withDatabaseMaintenanceLock(resolveSqliteDatabasePath(), execute) : execute())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
