import fs from 'node:fs/promises';
import { ProductCategory } from '@prisma/client';
import env from '../config/env.js';
import { prisma, disconnectPrisma } from './prisma.js';
import { withDatabaseMaintenanceLock } from './maintenanceLock.js';
import { resolveSqliteDatabasePath } from './databasePath.js';
import { parseNonNegativeInteger } from '../utils/stockQuantity.js';
import { isSafeMonetaryValue } from '../utils/salePayment.js';

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) throw new Error('Importação exclusiva da filial Congo.');
  const content = await fs.readFile('data/seed/congo_tire_flaps_2026-10-15.csv', 'utf8');
  const [header, ...lines] = content.trim().split(/\r?\n/);
  if (header !== 'reference,description,cash_price,credit_price,stock,category') throw new Error('Cabeçalho inválido.');
  const rows = lines.map(line => {
    const fields = line.split(',');
    if (fields.length !== 6) throw new Error('Linha inválida.');
    const [reference, description, cashPrice, creditPrice, stock, category] = fields as [string, string, string, string, string, string];
    const quantity = parseNonNegativeInteger(stock);
    if (!reference.trim() || !description.trim() || category !== ProductCategory.TIRE_FLAP || quantity === null ||
        !/^\d+\.\d{2}$/.test(cashPrice) || !/^\d+\.\d{2}$/.test(creditPrice) ||
        !isSafeMonetaryValue(Number(cashPrice)) || !isSafeMonetaryValue(Number(creditPrice)) ||
        Number(cashPrice) <= 0 || Number(creditPrice) <= 0) throw new Error(`Produto inválido: ${reference}`);
    return { reference, description, cashPrice, creditPrice, stock: quantity, category: ProductCategory.TIRE_FLAP };
  });
  if (!rows.length || new Set(rows.map(row => row.reference)).size !== rows.length ||
      new Set(rows.map(row => row.description.toUpperCase())).size !== rows.length) throw new Error('Catálogo vazio ou duplicado.');
  const existing = await prisma.product.findMany();
  const creates = rows.filter(row => {
    const matches = existing.filter(product => product.reference === row.reference || product.description.toUpperCase() === row.description.toUpperCase());
    if (matches.some(product => product.reference !== row.reference || product.description !== row.description || product.category !== row.category)) {
      throw new Error(`Cadastro conflitante: ${row.description}`);
    }
    return matches.length === 0;
  });
  console.log(`CSV: ${rows.length} modelos; novos: ${creates.length}; já cadastrados: ${rows.length - creates.length}.`);
  if (!process.argv.includes('--apply')) return;
  await prisma.$transaction(creates.map(data => prisma.product.create({ data })));
  console.log(`Importados ${creates.length} protetores. Cadastros existentes preservados.`);
}
const execute = () => main().finally(disconnectPrisma);
(process.argv.includes('--apply') ? withDatabaseMaintenanceLock(resolveSqliteDatabasePath(), execute) : execute())
  .catch(error => { console.error(error); process.exitCode = 1; });
