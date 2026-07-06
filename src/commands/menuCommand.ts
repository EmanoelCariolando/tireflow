import { Message } from 'whatsapp-web.js';
import { handleBestSellersCommand } from './bestSellersCommand.js';
import { handleLowStockCommand } from './lowStockCommand.js';
import { handleTodayReportCommand } from './todayReportCommand.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearMenuSession,
  hasActiveMenuSession,
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

  if (!['1', '2', '3'].includes(selection)) {
    return false;
  }

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (!hasActiveMenuSession(userId, chatId)) {
    return false;
  }

  clearMenuSession(userId, chatId);

  if (selection === '1') {
    await handleTodayReportCommand(message);
    return true;
  }

  if (selection === '2') {
    await handleLowStockCommand(message);
    return true;
  }

  await handleBestSellersCommand(message);
  return true;
}
