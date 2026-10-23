import { Message } from 'whatsapp-web.js';
import { buildLowStockOperationalReport } from '../services/reportService.js';
import { clearLastQuery, saveLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';

export function isLowStockCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized === 'baixo' || normalized === 'baixo estoque';
}

export async function handleLowStockCommand(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearLastQuery(userId, chatId);
  try {
    const { report, products } = await buildLowStockOperationalReport();

    if (products.length > 0) {
      saveLastQuery(
        userId,
        chatId,
        'baixo estoque',
        products
      );
    }

    await message.reply(report);
  } catch (error) {
    clearLastQuery(userId, chatId);
    console.error('[LOW_STOCK] Error:', error);
    await message.reply('Ocorreu um erro ao consultar estoque baixo. Tente novamente.');
  }
}
