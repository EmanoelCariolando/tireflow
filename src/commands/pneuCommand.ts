import { Message } from 'whatsapp-web.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { saveLastQuery, QueriedProduct } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageUserId } from '../utils/messageContext.js';
import { findAvailableProductsByReference } from '../services/productService.js';

/**
 * Pneu Command - Fase 6 (Consulta real no banco)
 * 
 * Responsibilities:
 * - Detect "pneu <medida>"
 * - Normalize the tire size (175/70 R14 etc.)
 * - Return a numbered list of active matching products with stock
 * - Save the last query in memory for 5 minutes (per SPEC)
 * 
 * Does NOT start any sale/operation by itself.
 * Sale is handled by saleCommand.
 */

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

export function isPneuHelpCommand(body: string): boolean {
  return body.trim().toLowerCase() === 'pneu';
}

export function isPneuCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized.startsWith('pneu ');
}

export async function handlePneuHelpCommand(message: Message): Promise<void> {
  await message.reply(
    [
      'Comandos após consultar pneus:',
      '',
      'venda <número> <quantidade>',
      'entrada <número>',
      'ajuste <número>',
      'preco <número>',
    ].join('\n')
  );
}

export async function handlePneuCommand(message: Message, rawMeasure: string): Promise<void> {
  const startedAt = Date.now();

  try {
    const normalized = normalizeTireSize(rawMeasure);

    if (!normalized) {
      await message.reply('Medida inválida. Exemplo: pneu 175/70 R14');
      return;
    }

    const queryStartedAt = Date.now();
    const matches = await findAvailableProductsByReference(normalized);
    const queryMs = Date.now() - queryStartedAt;

    if (matches.length === 0) {
      const replyStartedAt = Date.now();
      await message.reply(`Nenhum pneu encontrado para ${normalized}.`);
      const replyMs = Date.now() - replyStartedAt;
      console.log(
        `[PNEU] ${message.from} -> ${normalized} (0 produtos) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
          Date.now() - startedAt
        }`
      );
      return;
    }

    // Save last consultation (5 minute TTL) - required for indexed commands
    saveLastQuery(getMessageUserId(message), normalized, matches);

    const response = formatProductList(matches, normalized);
    const replyStartedAt = Date.now();
    await message.reply(response);
    const replyMs = Date.now() - replyStartedAt;

    console.log(
      `[PNEU] ${message.from} -> ${normalized} (${matches.length} produtos) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
        Date.now() - startedAt
      }`
    );
  } catch (error) {
    console.error('[PNEU] Error:', error);
    await message.reply('Ocorreu um erro ao consultar os pneus. Tente novamente.');
  }
}
