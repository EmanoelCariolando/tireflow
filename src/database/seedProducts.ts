import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { disconnectPrisma } from './prisma.js';
import { productRepository } from '../repositories/productRepository.js';

interface CsvRow {
  reference: string;
  description: string;
  cash_price: string;
  credit_price: string;
  stock: string;
}

interface ValidProduct {
  line: number;
  reference: string;
  description: string;
  cashPrice: string;
  creditPrice: string;
  stock: number;
}

interface InvalidRow {
  line: number;
  reason: string;
}

interface SeedReport {
  totalRows: number;
  created: number;
  invalidRows: InvalidRow[];
  duplicateRows: InvalidRow[];
}

const REQUIRED_HEADERS = ['reference', 'description', 'cash_price', 'credit_price', 'stock'];
const CSV_PATH = path.resolve(process.cwd(), 'data', 'seed', 'initial_products.csv');

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
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeKey(reference: string, description: string): string {
  return `${reference.trim().toUpperCase()}::${description.trim().toUpperCase()}`;
}

function parseMoney(value: string): string | null {
  const normalized = value.trim().replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  return new Prisma.Decimal(normalized).toFixed(2);
}

function parseStock(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  return Number(value);
}

function buildCsvRow(headers: string[], values: string[]): CsvRow {
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));

  return {
    reference: row.reference,
    description: row.description,
    cash_price: row.cash_price,
    credit_price: row.credit_price,
    stock: row.stock,
  };
}

function validateRow(line: number, row: CsvRow): ValidProduct | InvalidRow {
  const reference = row.reference.trim();
  const description = row.description.trim();
  const cashPrice = parseMoney(row.cash_price);
  const creditPrice = parseMoney(row.credit_price);
  const stock = parseStock(row.stock);

  if (!reference) {
    return { line, reason: 'reference vazio' };
  }

  if (!description) {
    return { line, reason: 'description vazio' };
  }

  if (!cashPrice) {
    return { line, reason: 'cash_price inválido' };
  }

  if (!creditPrice) {
    return { line, reason: 'credit_price inválido' };
  }

  if (stock === null) {
    return { line, reason: 'stock inválido' };
  }

  return {
    line,
    reference,
    description,
    cashPrice,
    creditPrice,
    stock,
  };
}

async function readProductsFromCsv(): Promise<{
  products: ValidProduct[];
  invalidRows: InvalidRow[];
  totalRows: number;
}> {
  const fileContent = await fs.readFile(CSV_PATH, 'utf8');
  const lines = fileContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('CSV vazio.');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`CSV sem colunas obrigatórias: ${missingHeaders.join(', ')}`);
  }

  const products: ValidProduct[] = [];
  const invalidRows: InvalidRow[] = [];

  for (let index = 1; index < lines.length; index++) {
    const line = index + 1;
    const values = parseCsvLine(lines[index]);
    const row = buildCsvRow(headers, values);
    const validated = validateRow(line, row);

    if ('reason' in validated) {
      invalidRows.push(validated);
      continue;
    }

    products.push(validated);
  }

  return {
    products,
    invalidRows,
    totalRows: lines.length - 1,
  };
}

async function seedProducts(): Promise<SeedReport> {
  const { products, invalidRows, totalRows } = await readProductsFromCsv();
  const seenKeys = new Set<string>();
  const duplicateRows: InvalidRow[] = [];
  let created = 0;

  for (const product of products) {
    const key = normalizeKey(product.reference, product.description);

    if (seenKeys.has(key)) {
      duplicateRows.push({ line: product.line, reason: 'duplicado no CSV' });
      continue;
    }

    seenKeys.add(key);

    const existingProduct = await productRepository.findByReferenceAndDescription(
      product.reference,
      product.description,
    );

    if (existingProduct) {
      duplicateRows.push({ line: product.line, reason: 'produto já existe no banco' });
      continue;
    }

    await productRepository.create({
      reference: product.reference,
      description: product.description,
      cashPrice: product.cashPrice,
      creditPrice: product.creditPrice,
      stock: product.stock,
    });

    created++;
  }

  return {
    totalRows,
    created,
    invalidRows,
    duplicateRows,
  };
}

function printRows(title: string, rows: InvalidRow[]): void {
  if (rows.length === 0) {
    return;
  }

  const visibleRowsLimit = 20;
  const visibleRows = rows.slice(0, visibleRowsLimit);
  const hiddenRows = rows.length - visibleRows.length;

  console.log(`\n${title}`);

  visibleRows.forEach((row) => {
    console.log(`- Linha ${row.line}: ${row.reason}`);
  });

  if (hiddenRows > 0) {
    console.log(`... ${hiddenRows} outras linhas omitidas.`);
  }
}

function printReport(report: SeedReport): void {
  console.log('\nSeed de produtos finalizado.');
  console.log(`Linhas lidas: ${report.totalRows}`);
  console.log(`Produtos criados: ${report.created}`);
  console.log(`Linhas inválidas: ${report.invalidRows.length}`);
  console.log(`Duplicados ignorados: ${report.duplicateRows.length}`);

  printRows('Linhas inválidas:', report.invalidRows);
  printRows('Duplicados ignorados:', report.duplicateRows);
}

async function main(): Promise<void> {
  console.log('Iniciando seed de produtos...');
  console.log(`Arquivo: ${CSV_PATH}`);

  const report = await seedProducts();
  printReport(report);
}

main()
  .catch((error: unknown) => {
    console.error('Erro ao executar seed de produtos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
