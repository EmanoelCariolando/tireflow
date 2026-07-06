import { Message } from 'whatsapp-web.js';
import {
  isPneuCommand,
  handlePneuCommand,
  isPneuHelpCommand,
  handlePneuHelpCommand,
} from '../commands/pneuCommand.js';
import { isSaleCommand, handleSaleCommand, handleSaleConversation } from '../commands/saleCommand.js';
import { isEntryCommand, handleEntryCommand, handleEntryConversation } from '../commands/entryCommand.js';
import {
  isAdjustmentCommand,
  handleAdjustmentCommand,
  handleAdjustmentConversation,
} from '../commands/adjustmentCommand.js';
import { isPriceCommand, handlePriceCommand, handlePriceConversation } from '../commands/priceCommand.js';
import { isGroupIdCommand, handleGroupIdCommand } from '../commands/groupIdCommand.js';
import { isLowStockCommand, handleLowStockCommand } from '../commands/lowStockCommand.js';
import { isBestSellersCommand, handleBestSellersCommand } from '../commands/bestSellersCommand.js';
import { isTodayReportCommand, handleTodayReportCommand } from '../commands/todayReportCommand.js';
import { isMenuCommand, handleMenuCommand, handleMenuSelection } from '../commands/menuCommand.js';
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
  const body = message.body?.trim() || '';

  if (body && isGroupIdCommand(body)) {
    await handleGroupIdCommand(message);
    return;
  }

  if (!isAuthorizedChat(message)) {
    return;
  }

  console.log(`[MSG] From: ${message.from} | Body: "${body}" | Media: ${message.hasMedia}`);

  if (await handlePriceConversation(message, body)) {
    return;
  }

  if (await handleAdjustmentConversation(message, body)) {
    return;
  }

  if (await handleEntryConversation(message, body)) {
    return;
  }

  if (await handleSaleConversation(message, body)) {
    return;
  }

  if (!body) {
    return;
  }

  if (await handleMenuSelection(message, body)) {
    return;
  }

  if (isMenuCommand(body)) {
    await handleMenuCommand(message);
    return;
  }

  if (isPneuHelpCommand(body)) {
    await handlePneuHelpCommand(message);
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

  if (isEntryCommand(body)) {
    await handleEntryCommand(message, body);
    return;
  }

  if (isAdjustmentCommand(body)) {
    await handleAdjustmentCommand(message, body);
    return;
  }

  if (isPriceCommand(body)) {
    await handlePriceCommand(message, body);
    return;
  }

  if (isLowStockCommand(body)) {
    await handleLowStockCommand(message);
    return;
  }

  if (isBestSellersCommand(body)) {
    await handleBestSellersCommand(message);
    return;
  }

  if (isTodayReportCommand(body)) {
    await handleTodayReportCommand(message);
    return;
  }
}

function isAuthorizedChat(message: Message): boolean {
  if (isGroupMessage(message)) {
    return Boolean(env.whatsappOfficialGroupId) && message.from === env.whatsappOfficialGroupId;
  }

  return env.allowPrivateTestMode;
}
