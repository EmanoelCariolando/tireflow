import { Message } from 'whatsapp-web.js';
import { isPingCommand, handlePingCommand } from '../commands/pingCommand.js';
import { isPneuCommand, handlePneuCommand } from '../commands/pneuCommand.js';

/**
 * Message Handler (Fase 2)
 * 
 * Responsible for:
 * - Receiving incoming WhatsApp messages
 * - Identifying commands
 * - Routing to the appropriate command handler
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

  if (isPneuCommand(body)) {
    // Extract everything after "pneu " (case-insensitive detection already done)
    const rawMeasure = body.trim().slice(5).trim();
    await handlePneuCommand(message, rawMeasure);
    return;
  }

  // No other commands in Fase 2
  // Future phases will add: venda, entrada, etc.
}
