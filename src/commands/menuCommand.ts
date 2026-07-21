import { Message } from 'whatsapp-web.js';
import { handleBestSellersCommand } from './bestSellersCommand.js';
import { handleTodayReportCommand } from './todayReportCommand.js';
import { findActiveProductsByReference } from '../services/productService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { saveLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  clearMenuSession,
  getMenuSession,
  saveMenuSession,
} from '../utils/menuSessionStore.js';

const MENU_TEXT = [
  '🤖 TireFlow',
  '',
  '📊 MENU',
  '',
  '1️⃣ Relatório de hoje',
  '2️⃣ Baixo estoque',
  '3️⃣ Mais vendidos',
  '',
  'Responda com:',
  '1, 2 ou 3',
].join('\n');

export function isMenuCommand(body: string): boolean {
  return body.trim().toLowerCase() === 'menu';
}

export async function handleMenuCommand(message: Message): Promise<void> {
  saveMenuSession(getMessageUserId(message), getMessageChatId(message));
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

  if (session.step === 'awaiting_low_stock_measure') {
    await handleLowStockMeasureStep(message, body, userId, chatId);
    return true;
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
    saveMenuSession(userId, chatId, 'awaiting_low_stock_measure');
    await message.reply('Digite a medida do pneu que está sem estoque.\n\nExemplo: 175 70 14');
    return true;
  }

  clearMenuSession(userId, chatId);
  await handleBestSellersCommand(message);
  return true;
}

async function handleLowStockMeasureStep(
  message: Message,
  rawMeasure: string,
  userId: string,
  chatId: string
): Promise<void> {
  const normalized = normalizeTireSize(rawMeasure);

  if (!normalized) {
    saveMenuSession(userId, chatId, 'awaiting_low_stock_measure');
    await message.reply('Medida inválida. Exemplo: 175 70 14');
    return;
  }

  const products = await findActiveProductsByReference(normalized);
  const zeroStockProducts = products.filter((product) => product.stock <= 0);

  clearMenuSession(userId, chatId);

  if (products.length === 0) {
    await message.reply(`Nenhum pneu encontrado para ${normalized}.`);
    return;
  }

  if (zeroStockProducts.length === 0) {
    await message.reply(`Nenhum pneu zerado encontrado para ${normalized}.`);
    return;
  }

  saveLastQuery(userId, chatId, normalized, zeroStockProducts);
  await message.reply(formatZeroStockProductList(zeroStockProducts, normalized));
}

function formatZeroStockProductList(products: QueriedProduct[], normalized: string): string {
  let text = `🛞 ${normalized} - estoque 0\n\n`;

  products.forEach((product, index) => {
    text += `${index + 1}️⃣ ${product.description}\n`;
    text += `📦 Estoque: ${product.stock}\n`;
    text += `💰 À vista: ${formatCurrency(product.cashPrice)}\n`;
    text += `💳 A prazo: ${formatCurrency(product.creditPrice)}\n`;

    if (index < products.length - 1) {
      text += '\n';
    }
  });

  text += '\nPara repor estoque:\nentrada 1';

  return text;
}
