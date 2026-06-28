import { Message } from 'whatsapp-web.js';

/**
 * Ping Command (Phase 1)
 * 
 * Simple health-check command.
 * Responds with "pong" when user sends "ping".
 * 
 * This is the only command implemented in Fase 1.
 */
export async function handlePingCommand(message: Message): Promise<void> {
  try {
    await message.reply('pong');
    console.log(`[PING] Responded to ping from ${message.from}`);
  } catch (error) {
    console.error('[PING] Error replying to ping:', error);
  }
}

/**
 * Check if the message body is a ping command.
 * Case-insensitive and trims whitespace.
 */
export function isPingCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized === 'ping';
}
