import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env.js';
import { normalizeStockLocation } from '../utils/stockLocation.js';
import { disconnectPrisma, prisma } from './prisma.js';

interface CsvLocationRow {
  line: number;
  reference: string;
  description: string;
  stockLocation: string;
}

interface LocationUpdate {
  productId: string;
  reference: string;
  description: string;
  previousLocation: string | null;
  stockLocation: string;
}

const REQUIRED_HEADERS = ['reference', 'description', 'location'];

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

async function readLocationRows(csvPath: string): Promise<CsvLocationRow[]> {
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

  const rows: CsvLocationRow[] = [];
  const seenKeys = new Map<string, string>();

  for (let index = 1; index < lines.length; index++) {
    const values = parseCsvLine(lines[index]);
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']));
    const rawLocation = row.location.trim();

    if (!rawLocation) {
      continue;
    }

    const stockLocation = normalizeStockLocation(rawLocation);
    if (!stockLocation) {
      throw new Error(`Linha ${index + 1}: location inválido.`);
    }

    const reference = row.reference.trim();
    const description = row.description.trim();
    if (!reference || !description) {
      throw new Error(`Linha ${index + 1}: reference ou description vazio.`);
    }

    const key = normalizeProductKey(reference, description);
    const previousLocation = seenKeys.get(key);
    if (previousLocation && previousLocation !== stockLocation) {
      throw new Error(`Linha ${index + 1}: produto repetido com localizações diferentes.`);
    }

    if (!previousLocation) {
      seenKeys.set(key, stockLocation);
      rows.push({
        line: index + 1,
        reference,
        description,
        stockLocation,
      });
    }
  }

  return rows;
}

async function buildLocationUpdates(rows: CsvLocationRow[]): Promise<{
  updates: LocationUpdate[];
  unchanged: number;
  missing: CsvLocationRow[];
}> {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      reference: true,
      description: true,
      stockLocation: true,
    },
  });
  const productsByKey = new Map(
    products.map((product) => [
      normalizeProductKey(product.reference, product.description),
      product,
    ])
  );
  const updates: LocationUpdate[] = [];
  const missing: CsvLocationRow[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const product = productsByKey.get(normalizeProductKey(row.reference, row.description));
    if (!product) {
      missing.push(row);
      continue;
    }

    if (product.stockLocation === row.stockLocation) {
      unchanged++;
      continue;
    }

    updates.push({
      productId: product.id,
      reference: product.reference,
      description: product.description,
      previousLocation: product.stockLocation,
      stockLocation: row.stockLocation,
    });
  }

  return { updates, unchanged, missing };
}

function printMissingRows(rows: CsvLocationRow[]): void {
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

async function main(): Promise<void> {
  if (!/\bMONTEIRO\b/i.test(env.branchName)) {
    throw new Error('Sincronização cancelada: BRANCH_NAME não corresponde a Monteiro.');
  }

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const csvArgument = args.find((argument) => argument !== '--apply');
  if (!csvArgument) {
    throw new Error(
      'Informe o CSV. Exemplo: npm run sync:locations -- data/seed/monteiro_products.csv'
    );
  }

  const csvPath = path.resolve(csvArgument);
  const rows = await readLocationRows(csvPath);
  const { updates, unchanged, missing } = await buildLocationUpdates(rows);

  console.log(`Filial: ${env.branchName}`);
  console.log(`Produtos com localização no CSV: ${rows.length}`);
  console.log(`Localizações a atualizar: ${updates.length}`);
  console.log(`Localizações já corretas: ${unchanged}`);
  console.log(`Produtos não encontrados: ${missing.length}`);
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
        data: { stockLocation: update.stockLocation },
      })
    )
  );

  console.log(`\nSincronização concluída: ${updates.length} localizações atualizadas.`);
  console.log('Estoque, preços, fotos, vendas e demais dados não foram alterados.');
}

main()
  .catch((error: unknown) => {
    console.error('Erro ao sincronizar localizações:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
