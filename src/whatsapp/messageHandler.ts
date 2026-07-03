import { Message } from 'whatsapp-web.js';
import { isPingCommand, handlePingCommand } from '../commands/pingCommand.js';
import { isPneuCommand, handlePneuCommand } from '../commands/pneuCommand.js';
import { isSaleCommand, handleSaleCommand, handleSaleConversation } from '../commands/saleCommand.js';
import env from '../config/env.js';
import { isGroupMessage } from '../utils/messageContext.js';

/**
 * Message Handler (Fase 3)
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
  if (!isAuthorizedChat(message)) {
    return;
  }

  const body = message.body?.trim() || '';

  console.log(`[MSG] From: ${message.from} | Body: "${body}" | Media: ${message.hasMedia}`);

  if (await handleSaleConversation(message, body)) {
    return;
  }

  if (!body) {
    return;
  }

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

  if (isSaleCommand(body)) {
    await handleSaleCommand(message, body);
    return;
  }

  // Future phases will add: entrada, ajuste, preco, etc.
}

function isAuthorizedChat(message: Message): boolean {
  if (isGroupMessage(message)) {
    return Boolean(env.whatsappOfficialGroupId) && message.from === env.whatsappOfficialGroupId;
  }

  return env.allowPrivateTestMode;
}
