import { Message } from 'whatsapp-web.js';
import { buildTodayReport } from '../services/reportService.js';

export function isTodayReportCommand(body: string): boolean {
  return normalizeCommand(body) === 'relatorio hoje';
}

export async function handleTodayReportCommand(message: Message): Promise<void> {
  try {
    const report = await buildTodayReport();
    await message.reply(report);
  } catch (error) {
    console.error('[TODAY_REPORT] Error:', error);
    await message.reply('Ocorreu um erro ao gerar o relatório de hoje. Tente novamente.');
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
