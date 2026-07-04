import { Message } from 'whatsapp-web.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { saveLastQuery, QueriedProduct } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageUserId } from '../utils/messageContext.js';
import { findActiveProductsByReference } from '../services/productService.js';

/**
 * Pneu Command - Fase 6 (Consulta real no banco)
 * 
 * Responsibilities:
 * - Detect "pneu <medida>"
 * - Normalize the tire size (175/70 R14 etc.)
 * - Return a numbered list of active matching products from the database
 * - Save the last query in memory for 5 minutes (per SPEC)
 * 
 * Does NOT start any sale/operation by itself.
 * Sale is handled by saleCommand.
 */

// Compatibilidade temporaria para a venda fake da Fase 3.
// Na Fase 7, a venda real passara a consultar e alterar o banco.
const fakeSaleProducts = new Map<string, QueriedProduct>();

function rememberProductsForFakeSale(products: QueriedProduct[]): void {
  products.forEach((product) => {
    fakeSaleProducts.set(product.id, { ...product });
  });
}

export function getFakeProductById(productId: string): QueriedProduct | null {
  const product = fakeSaleProducts.get(productId);
  return product ? { ...product } : null;
}

export function decreaseFakeProductStock(productId: string, quantity: number): QueriedProduct | null {
  const product = fakeSaleProducts.get(productId);

  if (!product || product.stock < quantity) {
    return null;
  }

  product.stock -= quantity;
  return { ...product };
}

function formatProductList(products: QueriedProduct[], normalized: string): string {
  let text = `🛞 ${normalized}\n\n`;

  products.forEach((product, index) => {
    const num = index + 1;
    text += `${num}️⃣ ${product.description}\n`;
    text += `📦 Estoque: ${product.stock}\n`;
    text += `💰 À vista: ${formatCurrency(product.cashPrice)}\n`;
    text += `💳 A prazo: ${formatCurrency(product.creditPrice)}\n`;

    if (index < products.length - 1) {
      text += '\n';
    }
  });

  text += '\nPara vender digite:\nvenda 1 5';

  return text;
}

export function isPneuCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized.startsWith('pneu ');
}

export async function handlePneuCommand(message: Message, rawMeasure: string): Promise<void> {
  try {
    const normalized = normalizeTireSize(rawMeasure);

    if (!normalized) {
      await message.reply('Medida inválida. Exemplo: pneu 175/70 R14');
      return;
    }

    const matches = await findActiveProductsByReference(normalized);

    if (matches.length === 0) {
      await message.reply(`Nenhum pneu encontrado para ${normalized}.`);
      return;
    }

    rememberProductsForFakeSale(matches);

    // Save last consultation (5 minute TTL) - required for indexed commands
    saveLastQuery(getMessageUserId(message), normalized, matches);

    const response = formatProductList(matches, normalized);
    await message.reply(response);

    console.log(`[PNEU] ${message.from} → ${normalized} (${matches.length} produtos)`);
  } catch (error) {
    console.error('[PNEU] Error:', error);
    await message.reply('Ocorreu um erro ao consultar os pneus. Tente novamente.');
  }
}
