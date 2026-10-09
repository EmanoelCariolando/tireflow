import fs from 'node:fs/promises';
import { ProductCategory } from '@prisma/client';
import env from '../config/env.js';
import { prisma, disconnectPrisma } from './prisma.js';

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) throw new Error('Importação exclusiva da filial Congo.');
  const content = await fs.readFile('data/seed/congo_inner_tubes_2026-10-08.csv', 'utf8');
  const [header, ...lines] = content.trim().split(/\r?\n/);
  if (header !== 'reference,description,cash_price,credit_price,stock,category') throw new Error('Cabeçalho inválido.');
  const rows = lines.map(line => {
    const fields = line.split(',');
    if (fields.length !== 6) throw new Error('Linha inválida.');
    const [reference, description, cashPrice, creditPrice, stock, category] = fields as [string, string, string, string, string, string];
    if (!reference || !description || !/^\d+\.\d{2}$/.test(cashPrice) || !/^\d+\.\d{2}$/.test(creditPrice) || !/^\d+$/.test(stock) || ![ProductCategory.INNER_TUBE, ProductCategory.MOTORCYCLE_INNER_TUBE].includes(category as never)) throw new Error(`Produto inválido: ${reference}`);
    return { reference, description, cashPrice, creditPrice, stock: Number(stock), category: category as ProductCategory };
  });
  if (new Set(rows.map(row => row.reference)).size !== rows.length) throw new Error('Referências duplicadas.');
  const existing = await prisma.product.findMany();
  const creates = rows.filter(row => {
    const matches = existing.filter(product => product.reference === row.reference || product.description.toUpperCase() === row.description.toUpperCase());
    if (matches.some(product => product.reference !== row.reference || product.description !== row.description || product.category !== row.category)) throw new Error(`Cadastro conflitante: ${row.description}`);
    return matches.length === 0;
  });
  console.log(`CSV: ${rows.length} modelos; novos: ${creates.length}; já cadastrados: ${rows.length - creates.length}.`);
  if (!process.argv.includes('--apply')) return;
  await prisma.$transaction(creates.map(data => prisma.product.create({ data })));
  console.log(`Importados ${creates.length} modelos. Cadastros existentes preservados.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(disconnectPrisma);
