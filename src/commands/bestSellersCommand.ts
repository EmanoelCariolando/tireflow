import { Message } from 'whatsapp-web.js';
import { buildBestSellersReport } from '../services/reportService.js';

export function isBestSellersCommand(body: string): boolean {
  return normalizeCommand(body) === 'mais vendidos';
}

export async function handleBestSellersCommand(message: Message): Promise<void> {
  try {
    const report = await buildBestSellersReport();
    await message.reply(report);
  } catch (error) {
    console.error('[BEST_SELLERS] Error:', error);
    await message.reply('Ocorreu um erro ao consultar mais vendidos. Tente novamente.');
  }
}

function normalizeCommand(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
