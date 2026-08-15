import { Message } from 'whatsapp-web.js';
import { handleBestSellersCommand } from './bestSellersCommand.js';
import { handleTodayReportCommand } from './todayReportCommand.js';
import {
  findActiveProductsByReference,
  findSuggestedActiveReferences,
} from '../services/productService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { formatStockLocationLine } from '../utils/stockLocation.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { saveLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  clearMenuSession,
  getMenuSession,
  saveMenuSession,
} from '../utils/menuSessionStore.js';
import env from '../config/env.js';
import { handleProductRegistrationStart } from './productRegistrationCommand.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import {
  formatReferenceSuggestions,
  formatResolvedReferenceNotice,
  formatProductChoiceQuestion,
} from './pneuCommand.js';
import { saveProductActionSession } from '../utils/productActionSessionStore.js';

const MENU_TEXT = [
  '🤖 *TIREFLOW — MENU*',
  '',
  '1️⃣ Relatório de hoje',
  '2️⃣ Mais vendidos',
  '3️⃣ Cadastrar pneu',
  '',
  'Responda: *1*, *2* ou *3*',
].join('\n');

export function isMenuCommand(body: string): boolean {
  return body.trim().toLowerCase() === 'menu';
}

export function isZeroStockCommand(body: string): boolean {
  return /^zero(?:\s|$)/i.test(body.trim());
}

export async function handleZeroStockCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const rawMeasure = body.trim().replace(/^zero(?:\s+|$)/i, '');
  const normalized = normalizeTireSize(rawMeasure);

  clearAllOperationSessions(userId, chatId);

  try {
    if (!normalized) {
      const suggestions = await findSuggestedActiveReferences(rawMeasure);
      const suggestionText = formatReferenceSuggestions(suggestions);
      await message.reply(
        '❌ Medida inválida. Ex.: *zero 175 70 14*' +
          (suggestionText ? `\n\n${suggestionText}` : '')
      );
      return;
    }

    await replyWithZeroStockProducts(message, normalized, userId, chatId);
  } catch (error) {
    console.error('[ZERO STOCK] Error:', error);
    await message.reply('❌ *ERRO NA CONSULTA*\nTente novamente.');
  }
}

export async function handleMenuCommand(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAllOperationSessions(userId, chatId);
  saveMenuSession(userId, chatId);
  await message.reply(MENU_TEXT);
}

export async function handleMenuSelection(message: Message, body: string): Promise<boolean> {
  const selection = body.trim();
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const session = getMenuSession(userId, chatId);

  if (!session) {
    return false;
  }

  if (!['1', '2', '3'].includes(selection)) {
    return false;
  }

  if (selection === '1') {
    clearMenuSession(userId, chatId);
    await handleTodayReportCommand(message);
    return true;
  }

  if (selection === '2') {
    clearMenuSession(userId, chatId);
    await handleBestSellersCommand(message);
    return true;
  }

  clearMenuSession(userId, chatId);
  await handleProductRegistrationStart(message);
  return true;
}

async function replyWithZeroStockProducts(
  message: Message,
  normalized: string,
  userId: string,
  chatId: string
): Promise<void> {
  const products = await findActiveProductsByReference(normalized);
  const zeroStockProducts = products.filter((product) => product.stock <= 0);

  clearMenuSession(userId, chatId);

  if (products.length === 0) {
    const suggestions = await findSuggestedActiveReferences(normalized);
    const suggestionText = formatReferenceSuggestions(suggestions);
    await message.reply(
      `🔎 Nenhum pneu encontrado para *${normalized}*.` +
        (suggestionText ? `\n\n${suggestionText}` : '')
    );
    return;
  }

  if (zeroStockProducts.length === 0) {
    await message.reply(`✅ Nenhum pneu *${normalized}* está zerado.`);
    return;
  }

  saveLastQuery(userId, chatId, normalized, zeroStockProducts);
  const referenceNotice = formatResolvedReferenceNotice(normalized, zeroStockProducts);
  await message.reply(
    (referenceNotice ? `${referenceNotice}\n\n` : '') +
      formatZeroStockProductList(zeroStockProducts, normalized)
  );
  saveProductActionSession(userId, chatId, 'awaiting_product', undefined, 'zero_stock');
  await message.reply(formatProductChoiceQuestion());
}

export function formatZeroStockProductList(
  products: QueriedProduct[],
  normalized: string,
  inventoryLocationsEnabled = env.inventoryLocationsEnabled
): string {
  const totalLabel = products.length === 1 ? '1 modelo' : `${products.length} modelos`;
  let text = `🛞 *${normalized}*\n\n⚠️ *ESTOQUE ZERO — ${totalLabel}*\n`;

  products.forEach((product, index) => {
    text += `\n${index + 1}️⃣ *${product.description}*\n`;
    text += `📦 Estoque: *${product.stock}*\n`;
    if (inventoryLocationsEnabled) {
      const stockLocationLine =
        formatStockLocationLine(product.stockLocation, true) ?? '📍 Local: *não cadastrado*';
      text += `${stockLocationLine}\n`;
    }
    text += `💰 À vista: *${formatCurrency(product.cashPrice)}*\n`;
    text += `💳 A prazo: *${formatCurrency(product.creditPrice)}*`;
    if (index < products.length - 1) text += '\n';
  });

  return text;
}
