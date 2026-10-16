import fs from 'node:fs/promises';
import env from '../config/env.js';
import { prisma, disconnectPrisma } from './prisma.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';

type SourceRow = { source: string; ten_price: number; cash_price: number };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
function matches(row: SourceRow, product: { reference: string; description: string }): boolean {
  const source = normalize(row.source).replace(/^P\d+(?:\.\d+)?\s+/, '');
  const description = normalize(product.description);
  if (!source.endsWith(` ${description}`)) return false;
  const size = source.slice(0, -description.length).trim();
  return (normalizeTireSize(size) ?? size) === (normalizeTireSize(product.reference) ?? normalize(product.reference));
}

async function main(): Promise<void> {
  if (!/\bCONGO\b/i.test(env.branchName)) throw new Error('Importação exclusiva de Congo.');
  const rows: SourceRow[] = JSON.parse(await fs.readFile('data/seed/congo_ten_installment_source_2026-09-30.json', 'utf8'));
  if (rows.some(row => !Number.isFinite(row.ten_price) || row.ten_price <= 0 || row.ten_price < row.cash_price)) throw new Error('Preço 10X inválido.');
  const products = await prisma.product.findMany({ where: { category: 'TIRE' } });
  const decisions = (await fs.readFile('data/seed/congo_catalog_resolution.csv', 'utf8')).trim().split(/\r?\n/).slice(1).map(line => line.split(',')).filter(fields => fields[2] === 'MATCH');
  const updates: {id: string; price: number}[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const row of rows) {
    const candidates = products.filter(product => matches(row, product) || decisions.some(fields =>
      matches(row, { reference: fields[0]!, description: fields[1]! }) &&
      normalize(product.reference) === normalize(fields[3]!) && normalize(product.description) === normalize(fields[4]!)
    ));
    if (candidates.length === 0) { unmatched.push(row.source); continue; }
    if (candidates.length > 1) { ambiguous.push(row.source); continue; }
    const id = candidates[0]!.id;
    const previous = updates.find(update => update.id === id);
    if (previous && previous.price !== row.ten_price) { ambiguous.push(row.source); continue; }
    if (!previous) updates.push({ id, price: row.ten_price });
  }
  console.log(`Correspondências: ${updates.length}; sem correspondência: ${unmatched.length}; ambíguos: ${ambiguous.length}.`);
  await fs.mkdir('tmp', { recursive: true });
  await fs.writeFile('tmp/ten-installment-import-review.json', JSON.stringify({ unmatched, ambiguous }, null, 2));
  if (ambiguous.length) throw new Error('Correspondências ambíguas; nenhuma alteração aplicada.');
  if (!process.argv.includes('--apply')) return;
  await prisma.$transaction(updates.map(update => prisma.product.update({ where: { id: update.id }, data: { tenInstallmentPrice: update.price } })));
  console.log(`Preços 10X aplicados a ${updates.length} produtos. Estoques e demais preços preservados.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(disconnectPrisma);
