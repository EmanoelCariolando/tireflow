import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import env from '../config/env.js';
import { disconnectPrisma, prisma } from './prisma.js';

interface CsvCatalogRow {
  line: number;
  reference: string;
  description: string;
  cashPrice: string;
  creditPrice: string;
  stock: number;
}

interface CatalogUpdate {
  productId: string;
  reference: string;
  description: string;
  previousCashPrice: string;
  cashPrice: string;
  previousCreditPrice: string;
  creditPrice: string;
  previousStock: number;
  stock: number;
}

interface CatalogResolution {
  line: number;
  csvReference: string;
  csvDescription: string;
  action: 'CREATE' | 'MATCH';
  existingReference: string;
  existingDescription: string;
}

const REQUIRED_HEADERS = ['reference', 'description', 'cash_price', 'credit_price', 'stock'];
const RESOLUTION_HEADERS = [
  'csv_reference',
  'csv_description',
  'action',
  'existing_reference',
  'existing_description',
];

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

  if (insideQuotes) {
    throw new Error('CSV contém aspas não fechadas.');
  }

  values.push(current.trim());
  return values;
}

function normalizeProductKey(reference: string, description: string): string {
  return `${reference.trim().toUpperCase()}::${description.trim().toUpperCase()}`;
}

function parseMoney(value: string, line: number, column: string): string {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Linha ${line}: ${column} inválido.`);
  }
  return new Prisma.Decimal(normalized).toFixed(2);
}

function parseStock(value: string, line: number): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`Linha ${line}: stock deve ser um inteiro maior ou igual a zero.`);
  }
  const stock = Number(value);
  if (!Number.isSafeInteger(stock)) {
    throw new Error(`Linha ${line}: stock fora do limite aceito.`);
  }
  return stock;
}

async function readCatalogRows(csvPath: string): Promise<CsvCatalogRow[]> {
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

  const rows: CsvCatalogRow[] = [];
  const seenKeys = new Set<string>();

  for (let index = 1; index < lines.length; index++) {
    const line = index + 1;
    const values = parseCsvLine(lines[index]);
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']));
    const reference = row.reference.trim();
    const description = row.description.trim();

    if (!reference || !description) {
      throw new Error(`Linha ${line}: reference ou description vazio.`);
    }

    const key = normalizeProductKey(reference, description);
    if (seenKeys.has(key)) {
      throw new Error(`Linha ${line}: produto repetido no CSV.`);
    }
    seenKeys.add(key);

    rows.push({
      line,
      reference,
      description,
      cashPrice: parseMoney(row.cash_price, line, 'cash_price'),
      creditPrice: parseMoney(row.credit_price, line, 'credit_price'),
      stock: parseStock(row.stock, line),
    });
  }

  return rows;
}

async function readResolutions(resolutionPath: string): Promise<CatalogResolution[]> {
  const contents = await fs.readFile(resolutionPath, 'utf8');
  const lines = contents
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length === 0) {
    throw new Error('CSV de decisões vazio.');
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const missingHeaders = RESOLUTION_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`CSV de decisões sem colunas obrigatórias: ${missingHeaders.join(', ')}`);
  }

  const resolutions: CatalogResolution[] = [];
  const seenKeys = new Set<string>();
  for (let index = 1; index < lines.length; index++) {
    const line = index + 1;
    const values = parseCsvLine(lines[index]);
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']));
    const csvReference = row.csv_reference.trim();
    const csvDescription = row.csv_description.trim();
    const action = row.action.trim().toUpperCase();
    const existingReference = row.existing_reference.trim();
    const existingDescription = row.existing_description.trim();

    if (!csvReference || !csvDescription) {
      throw new Error(`Linha ${line} do CSV de decisões: produto do CSV vazio.`);
    }
    if (action !== 'CREATE' && action !== 'MATCH') {
      throw new Error(`Linha ${line} do CSV de decisões: action deve ser CREATE ou MATCH.`);
    }
    if (action === 'MATCH' && (!existingReference || !existingDescription)) {
      throw new Error(`Linha ${line} do CSV de decisões: MATCH exige produto existente.`);
    }
    if (action === 'CREATE' && (existingReference || existingDescription)) {
      throw new Error(`Linha ${line} do CSV de decisões: CREATE não aceita produto existente.`);
    }

    const key = normalizeProductKey(csvReference, csvDescription);
    if (seenKeys.has(key)) {
      throw new Error(`Linha ${line} do CSV de decisões: produto repetido.`);
    }
    seenKeys.add(key);
    resolutions.push({
      line,
      csvReference,
      csvDescription,
      action,
      existingReference,
      existingDescription,
    });
  }
  return resolutions;
}

async function resolveMissingProducts(
  catalogRows: CsvCatalogRow[],
  candidates: CsvCatalogRow[],
  resolutions: CatalogResolution[]
): Promise<{
  matchedUpdates: CatalogUpdate[];
  matchedUnchanged: number;
  approvedCreates: CsvCatalogRow[];
  unresolved: CsvCatalogRow[];
  matchedExistingKeys: Set<string>;
}> {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      reference: true,
      description: true,
      cashPrice: true,
      creditPrice: true,
      stock: true,
    },
  });
  const productsByKey = new Map(
    products.map((product) => [normalizeProductKey(product.reference, product.description), product])
  );
  const candidatesByKey = new Map(
    candidates.map((candidate) => [
      normalizeProductKey(candidate.reference, candidate.description),
      candidate,
    ])
  );
  const catalogRowsByKey = new Map(
    catalogRows.map((row) => [normalizeProductKey(row.reference, row.description), row])
  );
  const exactCsvKeys = new Set(
    catalogRows
      .filter((row) => !candidatesByKey.has(normalizeProductKey(row.reference, row.description)))
      .map((row) => normalizeProductKey(row.reference, row.description))
  );
  const decisionsByKey = new Map<string, CatalogResolution>();
  const usedExistingKeys = new Set<string>();
  const matchedExistingKeys = new Set<string>();
  const matchedUpdates: CatalogUpdate[] = [];
  const approvedCreates: CsvCatalogRow[] = [];
  let matchedUnchanged = 0;

  for (const resolution of resolutions) {
    const csvKey = normalizeProductKey(resolution.csvReference, resolution.csvDescription);
    const candidate = candidatesByKey.get(csvKey);
    if (!candidate) {
      if (
        resolution.action === 'CREATE' &&
        catalogRowsByKey.has(csvKey) &&
        productsByKey.has(csvKey)
      ) {
        decisionsByKey.set(csvKey, resolution);
        continue;
      }
      throw new Error(
        `Linha ${resolution.line} do CSV de decisões não corresponde a um candidato: ` +
        `${resolution.csvReference} - ${resolution.csvDescription}`
      );
    }
    decisionsByKey.set(csvKey, resolution);

    if (resolution.action === 'CREATE') {
      approvedCreates.push(candidate);
      continue;
    }

    const existingKey = normalizeProductKey(
      resolution.existingReference,
      resolution.existingDescription
    );
    if (exactCsvKeys.has(existingKey)) {
      throw new Error(
        `Linha ${resolution.line}: produto existente também possui uma linha exata no CSV.`
      );
    }
    if (usedExistingKeys.has(existingKey)) {
      throw new Error(`Linha ${resolution.line}: produto existente usado em mais de uma decisão.`);
    }
    const product = productsByKey.get(existingKey);
    if (!product) {
      throw new Error(
        `Linha ${resolution.line}: produto existente não encontrado no banco: ` +
        `${resolution.existingReference} - ${resolution.existingDescription}`
      );
    }
    usedExistingKeys.add(existingKey);
    matchedExistingKeys.add(existingKey);

    const previousCashPrice = product.cashPrice.toFixed(2);
    const previousCreditPrice = product.creditPrice.toFixed(2);
    if (
      previousCashPrice === candidate.cashPrice &&
      previousCreditPrice === candidate.creditPrice &&
      product.stock === candidate.stock
    ) {
      matchedUnchanged++;
      continue;
    }
    matchedUpdates.push({
      productId: product.id,
      reference: product.reference,
      description: product.description,
      previousCashPrice,
      cashPrice: candidate.cashPrice,
      previousCreditPrice,
      creditPrice: candidate.creditPrice,
      previousStock: product.stock,
      stock: candidate.stock,
    });
  }

  const unresolved = candidates.filter(
    (candidate) =>
      !decisionsByKey.has(normalizeProductKey(candidate.reference, candidate.description))
  );
  return {
    matchedUpdates,
    matchedUnchanged,
    approvedCreates,
    unresolved,
    matchedExistingKeys,
  };
}

async function buildCatalogChanges(rows: CsvCatalogRow[]): Promise<{
  updates: CatalogUpdate[];
  unchanged: number;
  creates: CsvCatalogRow[];
  preserved: Array<{ reference: string; description: string }>;
}> {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      reference: true,
      description: true,
      cashPrice: true,
      creditPrice: true,
      stock: true,
    },
  });

  const productsByKey = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    const key = normalizeProductKey(product.reference, product.description);
    if (productsByKey.has(key)) {
      throw new Error(
        `Banco contém identidade duplicada sem diferenciar maiúsculas: ${product.reference} - ${product.description}`
      );
    }
    productsByKey.set(key, product);
  }

  const csvKeys = new Set(rows.map((row) => normalizeProductKey(row.reference, row.description)));
  const updates: CatalogUpdate[] = [];
  const creates: CsvCatalogRow[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const product = productsByKey.get(normalizeProductKey(row.reference, row.description));
    if (!product) {
      creates.push(row);
      continue;
    }

    const previousCashPrice = product.cashPrice.toFixed(2);
    const previousCreditPrice = product.creditPrice.toFixed(2);
    if (
      previousCashPrice === row.cashPrice &&
      previousCreditPrice === row.creditPrice &&
      product.stock === row.stock
    ) {
      unchanged++;
      continue;
    }

    updates.push({
      productId: product.id,
      reference: product.reference,
      description: product.description,
      previousCashPrice,
      cashPrice: row.cashPrice,
      previousCreditPrice,
      creditPrice: row.creditPrice,
      previousStock: product.stock,
      stock: row.stock,
    });
  }

  const preserved = products
    .filter((product) => !csvKeys.has(normalizeProductKey(product.reference, product.description)))
    .map((product) => ({ reference: product.reference, description: product.description }));

  return { updates, unchanged, creates, preserved };
}

function printUpdates(updates: CatalogUpdate[]): void {
  if (updates.length === 0) return;
  console.log('\nProdutos existentes a atualizar (nome e referência preservados):');
  for (const update of updates.slice(0, 50)) {
    console.log(
      `- ${update.reference} - ${update.description}: ` +
      `estoque ${update.previousStock} -> ${update.stock}; ` +
      `à vista ${update.previousCashPrice} -> ${update.cashPrice}; ` +
      `a prazo ${update.previousCreditPrice} -> ${update.creditPrice}`
    );
  }
  if (updates.length > 50) {
    console.log(`... ${updates.length - 50} outras atualizações omitidas.`);
  }
}

function printCreates(creates: CsvCatalogRow[]): void {
  if (creates.length === 0) return;
  console.log('\nProdutos do CSV não encontrados no banco (candidatos a cadastro novo):');
  for (const product of creates.slice(0, 50)) {
    console.log(
      `- Linha ${product.line}: ${product.reference} - ${product.description}; ` +
      `estoque ${product.stock}; à vista ${product.cashPrice}; a prazo ${product.creditPrice}`
    );
  }
  if (creates.length > 50) {
    console.log(`... ${creates.length - 50} outros candidatos omitidos.`);
  }
}

function printPreserved(preserved: Array<{ reference: string; description: string }>): void {
  if (preserved.length === 0) return;
  console.log('\nProdutos existentes ausentes do CSV (serão preservados sem alteração):');
  for (const product of preserved.slice(0, 20)) {
    console.log(`- ${product.reference} - ${product.description}`);
  }
  if (preserved.length > 20) {
    console.log(`... ${preserved.length - 20} outros produtos preservados omitidos.`);
  }
}

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) {
    throw new Error('Sincronização cancelada: BRANCH_NAME não corresponde ao Congo.');
  }

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const resolutionOptionIndex = args.indexOf('--resolution');
  const resolutionArgument =
    resolutionOptionIndex >= 0 ? args[resolutionOptionIndex + 1] : undefined;
  if (resolutionOptionIndex >= 0 && (!resolutionArgument || resolutionArgument.startsWith('--'))) {
    throw new Error('--resolution exige o caminho do CSV de decisões.');
  }
  const consumedResolutionArgument = resolutionArgument ? path.resolve(resolutionArgument) : '';
  const csvArgument = args.find(
    (argument, index) =>
      !argument.startsWith('--') &&
      !(resolutionOptionIndex >= 0 && index === resolutionOptionIndex + 1)
  );
  if (!csvArgument) {
    throw new Error(
      'Informe o CSV. Exemplo: npm run sync:catalog -- data/seed/initial_products.csv'
    );
  }

  const csvPath = path.resolve(csvArgument);
  const rows = await readCatalogRows(csvPath);
  const resolutions = consumedResolutionArgument
    ? await readResolutions(consumedResolutionArgument)
    : [];
  const { updates: exactUpdates, unchanged: exactUnchanged, creates, preserved } =
    await buildCatalogChanges(rows);
  const {
    matchedUpdates,
    matchedUnchanged,
    approvedCreates,
    unresolved,
    matchedExistingKeys,
  } = await resolveMissingProducts(rows, creates, resolutions);
  const updates = [...exactUpdates, ...matchedUpdates];
  const unchanged = exactUnchanged + matchedUnchanged;
  const actuallyPreserved = preserved.filter(
    (product) =>
      !matchedExistingKeys.has(normalizeProductKey(product.reference, product.description))
  );

  console.log(`Filial: ${env.branchName}`);
  console.log(`Produtos no CSV: ${rows.length}`);
  console.log(`Produtos existentes a atualizar: ${updates.length}`);
  console.log(`Produtos existentes já corretos: ${unchanged}`);
  console.log(`Produtos aprovados para cadastro novo: ${approvedCreates.length}`);
  console.log(`Candidatos ainda sem decisão: ${unresolved.length}`);
  console.log(`Produtos antigos preservados fora do CSV: ${actuallyPreserved.length}`);
  printUpdates(updates);
  printCreates(unresolved);
  printPreserved(actuallyPreserved);

  if (!apply) {
    console.log('\nConferência concluída. Nenhuma alteração foi feita.');
    if (unresolved.length > 0) {
      console.log(
        'Revise todos os candidatos e forneça um CSV de decisões com --resolution antes de aplicar.'
      );
    } else {
      console.log('Para aplicar as atualizações, execute novamente acrescentando --apply.');
    }
    return;
  }

  if (unresolved.length > 0) {
    throw new Error(
      'Nenhuma alteração foi feita. Existem candidatos sem decisão no CSV de resoluções.'
    );
  }

  const operations: Prisma.PrismaPromise<unknown>[] = updates.map((update) =>
    prisma.product.update({
      where: { id: update.productId },
      data: {
        stock: update.stock,
        cashPrice: update.cashPrice,
        creditPrice: update.creditPrice,
      },
    })
  );

  operations.push(
    ...approvedCreates.map((product) =>
      prisma.product.create({
        data: {
          reference: product.reference,
          description: product.description,
          stock: product.stock,
          cashPrice: product.cashPrice,
          creditPrice: product.creditPrice,
        },
      })
    )
  );

  if (operations.length > 0) {
    await prisma.$transaction(operations);
  }

  console.log(`\nSincronização concluída: ${updates.length} produtos existentes atualizados.`);
  console.log(`Produtos novos cadastrados: ${approvedCreates.length}.`);
  console.log('Nomes, referências, fotos, localizações, vendas e demais históricos foram preservados.');
  console.log('Produtos antigos ausentes do CSV não foram removidos nem desativados.');
}

main()
  .catch((error: unknown) => {
    console.error('Erro ao sincronizar catálogo:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
