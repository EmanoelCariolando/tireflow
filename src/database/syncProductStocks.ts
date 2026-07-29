import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env.js';
import { disconnectPrisma, prisma } from './prisma.js';

interface CsvStockRow {
  line: number;
  reference: string;
  description: string;
  stock: number;
}

interface StockUpdate {
  productId: string;
  reference: string;
  description: string;
  previousStock: number;
  stock: number;
}

const REQUIRED_HEADERS = ['reference', 'description', 'stock'];

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function normalizeProductKey(reference: string, description: string): string {
  return `${reference.trim().toUpperCase()}::${description.trim().toUpperCase()}`;
}

async function readStockRows(csvPath: string): Promise<CsvStockRow[]> {
  const contents = await fs.readFile(csvPath, 'utf8');
  const lines = contents
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('CSV vazio.');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`CSV sem colunas obrigatórias: ${missingHeaders.join(', ')}`);
  }

  const rows: CsvStockRow[] = [];
  const seenKeys = new Set<string>();

  for (let index = 1; index < lines.length; index++) {
    const values = parseCsvLine(lines[index]);
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']));
    const reference = row.reference.trim();
    const description = row.description.trim();
    const rawStock = row.stock.trim();

    if (!reference || !description) {
      throw new Error(`Linha ${index + 1}: reference ou description vazio.`);
    }

    if (!/^\d+$/.test(rawStock)) {
      throw new Error(`Linha ${index + 1}: stock deve ser um inteiro maior ou igual a zero.`);
    }

    const stock = Number(rawStock);
    if (!Number.isSafeInteger(stock)) {
      throw new Error(`Linha ${index + 1}: stock fora do limite aceito.`);
    }

    const key = normalizeProductKey(reference, description);
    if (seenKeys.has(key)) {
      throw new Error(`Linha ${index + 1}: produto repetido no CSV.`);
    }

    seenKeys.add(key);
    rows.push({
      line: index + 1,
      reference,
      description,
      stock,
    });
  }

  return rows;
}

async function buildStockUpdates(rows: CsvStockRow[]): Promise<{
  updates: StockUpdate[];
  unchanged: number;
  missing: CsvStockRow[];
}> {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      reference: true,
      description: true,
      stock: true,
    },
  });
  const productsByKey = new Map(
    products.map((product) => [
      normalizeProductKey(product.reference, product.description),
      product,
    ])
  );
  const updates: StockUpdate[] = [];
  const missing: CsvStockRow[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const product = productsByKey.get(normalizeProductKey(row.reference, row.description));
    if (!product) {
      missing.push(row);
      continue;
    }

    if (product.stock === row.stock) {
      unchanged++;
      continue;
    }

    updates.push({
      productId: product.id,
      reference: product.reference,
      description: product.description,
      previousStock: product.stock,
      stock: row.stock,
    });
  }

  return { updates, unchanged, missing };
}

function printMissingRows(rows: CsvStockRow[]): void {
  if (rows.length === 0) {
    return;
  }

  console.log('\nProdutos do CSV não encontrados no banco:');
  for (const row of rows.slice(0, 20)) {
    console.log(`- Linha ${row.line}: ${row.reference} - ${row.description}`);
  }
  if (rows.length > 20) {
    console.log(`... ${rows.length - 20} outros produtos omitidos.`);
  }
}

function printStockUpdates(updates: StockUpdate[]): void {
  if (updates.length === 0) {
    return;
  }

  console.log('\nAlterações de estoque encontradas:');
  for (const update of updates.slice(0, 50)) {
    console.log(
      `- ${update.reference} - ${update.description}: ${update.previousStock} -> ${update.stock}`
    );
  }
  if (updates.length > 50) {
    console.log(`... ${updates.length - 50} outras alterações omitidas.`);
  }
}

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) {
    throw new Error('Sincronização cancelada: BRANCH_NAME não corresponde ao Congo.');
  }

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const csvArgument = args.find((argument) => argument !== '--apply');
  if (!csvArgument) {
    throw new Error(
      'Informe o CSV. Exemplo: npm run sync:stocks -- data/seed/initial_products.csv'
    );
  }

  const csvPath = path.resolve(csvArgument);
  const rows = await readStockRows(csvPath);
  const { updates, unchanged, missing } = await buildStockUpdates(rows);

  console.log(`Filial: ${env.branchName}`);
  console.log(`Produtos no CSV: ${rows.length}`);
  console.log(`Estoques a atualizar: ${updates.length}`);
  console.log(`Estoques já corretos: ${unchanged}`);
  console.log(`Produtos não encontrados: ${missing.length}`);
  printStockUpdates(updates);
  printMissingRows(missing);

  if (missing.length > 0) {
    throw new Error('Nenhuma alteração foi feita. Corrija os produtos não encontrados.');
  }

  if (!apply) {
    console.log('\nConferência concluída. Nenhuma alteração foi feita.');
    console.log('Para aplicar, execute novamente acrescentando --apply.');
    return;
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.product.update({
        where: { id: update.productId },
        data: { stock: update.stock },
      })
    )
  );

  console.log(`\nSincronização concluída: ${updates.length} estoques atualizados.`);
  console.log(
    'Preços, descrições, fotos, localizações, vendas e demais dados não foram alterados.'
  );
}

main()
  .catch((error: unknown) => {
    console.error('Erro ao sincronizar estoques:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
