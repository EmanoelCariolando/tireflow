import { Message } from 'whatsapp-web.js';
import { isPingCommand, handlePingCommand } from '../commands/pingCommand.js';

/**
 * Message Handler (Phase 1)
 * 
 * Responsible for:
 * - Receiving incoming WhatsApp messages
 * - Identifying commands
 * - Routing to the appropriate command handler
 * 
 * In Fase 1, the ONLY command is "ping".
 * 
 * Architecture rule (from SPEC):
 * - messageHandler only identifies commands.
 * - commands handle the conversation flow.
 */
export async function handleIncomingMessage(message: Message): Promise<void> {
  // Ignore messages from groups for now (Phase 1 focus on direct/private)
  // We can expand this later when we implement group notifications.
  if (message.from.includes('@g.us')) {
    return;
  }

  const body = message.body?.trim() || '';

  // Skip empty messages
  if (!body) {
    return;
  }

  // Log incoming message (for development/debugging)
  console.log(`[MSG] From: ${message.from} | Body: "${body}"`);

  // Route commands
  if (isPingCommand(body)) {
    await handlePingCommand(message);
    return;
  }

  // No other commands in Phase 1
  // Future phases will add: pneu, venda, estoque, etc.
}
