import fs from 'node:fs/promises';
import { ProductCategory, Prisma } from '@prisma/client';
import env from '../config/env.js';
import { disconnectPrisma, prisma } from './prisma.js';

const CATALOG_PATH = 'data/seed/congo_retreaded_tires_2026-10-15.csv';

interface CatalogRow {
  line: number;
  reference: string;
  description: string;
  cashPrice: string;
  creditPrice: string;
  tenInstallmentPrice: string;
  stock: number;
  category: ProductCategory;
}

function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function parseMoney(value: string, line: number, column: string): string {
  if (!/^\d+\.\d{2}$/.test(value)) throw new Error(`Linha ${line}: ${column} inválido.`);
  return new Prisma.Decimal(value).toFixed(2);
}

async function readCatalog(): Promise<CatalogRow[]> {
  const content = await fs.readFile(CATALOG_PATH, 'utf8');
  const [header, ...lines] = content.trim().split(/\r?\n/);
  if (header !== 'reference,description,cash_price,credit_price,ten_installment_price,stock,category') {
    throw new Error('Cabeçalho inválido no catálogo de pneus cobertos.');
  }

  const rows = lines.map((line, index): CatalogRow => {
    const lineNumber = index + 2;
    const fields = line.split(',');
    if (fields.length !== 7) throw new Error(`Linha ${lineNumber}: quantidade de colunas inválida.`);
    const [reference, description, cash, credit, tenInstallment, stockValue, categoryValue] = fields as [string, string, string, string, string, string, string];
    if (!reference || !description || !/^\d+$/.test(stockValue)) {
      throw new Error(`Linha ${lineNumber}: referência, descrição ou estoque inválido.`);
    }
    if (
      categoryValue !== ProductCategory.RETREADED_TIRE &&
      categoryValue !== ProductCategory.MOTORCYCLE_RETREADED_TIRE
    ) {
      throw new Error(`Linha ${lineNumber}: categoria inválida.`);
    }
    return {
      line: lineNumber,
      reference,
      description,
      cashPrice: parseMoney(cash, lineNumber, 'cash_price'),
      creditPrice: parseMoney(credit, lineNumber, 'credit_price'),
      tenInstallmentPrice: parseMoney(tenInstallment, lineNumber, 'ten_installment_price'),
      stock: Number(stockValue),
      category: categoryValue as ProductCategory,
    };
  });

  const references = rows.map((row) => normalize(row.reference));
  if (new Set(references).size !== references.length) {
    throw new Error('O catálogo de pneus cobertos contém referências duplicadas.');
  }
  return rows;
}

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) {
    throw new Error('Importação exclusiva da filial Congo.');
  }

  const apply = process.argv.includes('--apply');
  const rows = await readCatalog();
  const products = await prisma.product.findMany();
  const byReference = new Map<string, Array<(typeof products)[number]>>();
  for (const product of products) {
    const key = normalize(product.reference);
    const matches = byReference.get(key) ?? [];
    matches.push(product);
    byReference.set(key, matches);
  }
  const descriptionCounts = new Map<string, number>();
  for (const row of rows) {
    const key = normalize(row.description);
    descriptionCounts.set(key, (descriptionCounts.get(key) ?? 0) + 1);
  }

  const usedIds = new Set<string>();
  const updates: Array<{ id: string; data: Prisma.ProductUpdateInput }> = [];
  const creates: Prisma.ProductCreateInput[] = [];

  for (const row of rows) {
    const descriptionKey = normalize(row.description);
    const referenceMatches = byReference.get(normalize(row.reference)) ?? [];
    const exactIdentityMatches = referenceMatches.filter(
      (product) => normalize(product.description) === descriptionKey
    );
    if (exactIdentityMatches.length > 1) {
      throw new Error(`Linha ${row.line}: identidade duplicada no banco.`);
    }
    if (referenceMatches.length > 1 && exactIdentityMatches.length === 0) {
      throw new Error(`Linha ${row.line}: referência do catálogo corresponde a vários cadastros.`);
    }
    const exactReference = exactIdentityMatches[0] ?? referenceMatches[0];
    const descriptionMatches = products.filter((product) =>
      normalize(product.description) === descriptionKey &&
      (descriptionCounts.get(descriptionKey) === 1 || product.cashPrice.toFixed(2) === row.cashPrice)
    );
    if (descriptionMatches.length > 1) {
      throw new Error(`Linha ${row.line}: mais de um cadastro existente corresponde ao produto.`);
    }
    const descriptionMatch = descriptionMatches[0];
    if (exactReference && descriptionMatch && exactReference.id !== descriptionMatch.id) {
      throw new Error(`Linha ${row.line}: referência e descrição apontam para cadastros diferentes.`);
    }
    const product = exactReference ?? descriptionMatch;

    if (!product) {
      creates.push({
        reference: row.reference,
        description: row.description,
        cashPrice: row.cashPrice,
        creditPrice: row.creditPrice,
        tenInstallmentPrice: row.tenInstallmentPrice,
        stock: row.stock,
        category: row.category,
      });
      continue;
    }
    if (usedIds.has(product.id)) throw new Error(`Linha ${row.line}: cadastro associado duas vezes.`);
    usedIds.add(product.id);

    const changed =
      product.reference !== row.reference ||
      product.description !== row.description ||
      product.category !== row.category ||
      product.cashPrice.toFixed(2) !== row.cashPrice ||
      product.creditPrice.toFixed(2) !== row.creditPrice ||
      product.tenInstallmentPrice?.toFixed(2) !== row.tenInstallmentPrice ||
      product.stock !== row.stock;
    if (changed) {
      updates.push({
        id: product.id,
        data: {
          reference: row.reference,
          description: row.description,
          category: row.category,
          batteryBrand: null,
          cashPrice: row.cashPrice,
          creditPrice: row.creditPrice,
          tenInstallmentPrice: row.tenInstallmentPrice,
          stock: row.stock,
        },
      });
    }
  }

  console.log(`Catálogo de cobertos de 15/10/2026: ${rows.length} modelos com preço.`);
  console.log(`Cadastros existentes a atualizar: ${updates.length}.`);
  console.log(`Cadastros novos a criar: ${creates.length}.`);
  if (!apply) {
    console.log('Conferência concluída. Nenhuma alteração foi feita. Use --apply para gravar.');
    return;
  }

  await prisma.$transaction([
    ...updates.map(({ id, data }) => prisma.product.update({ where: { id }, data })),
    ...creates.map((data) => prisma.product.create({ data })),
  ]);
  console.log('Importação de pneus cobertos concluída com sucesso.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
