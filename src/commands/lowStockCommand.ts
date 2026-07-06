import { Message } from 'whatsapp-web.js';
import { buildLowStockReport } from '../services/reportService.js';

export function isLowStockCommand(body: string): boolean {
  return body.trim().toLowerCase() === 'baixo';
}

export async function handleLowStockCommand(message: Message): Promise<void> {
  try {
    const report = await buildLowStockReport();
    await message.reply(report);
  } catch (error) {
    console.error('[LOW_STOCK] Error:', error);
    await message.reply('Ocorreu um erro ao consultar estoque baixo. Tente novamente.');
  }
}
