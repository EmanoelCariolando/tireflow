import type { Message } from 'whatsapp-web.js';
import { formatHealthStatus, getHealthSnapshot } from '../services/healthService.js';

export function isStatusCommand(body: string): boolean {
  return body.trim().toLowerCase() === 'status';
}

export async function handleStatusCommand(message: Message): Promise<void> {
  try {
    await message.reply(formatHealthStatus(await getHealthSnapshot()));
  } catch (error) {
    console.error('[STATUS] Health command failed.', error);
    await message.reply('⚠️ Não foi possível verificar o estado do TireFlow. Consulte os logs.');
  }
}
