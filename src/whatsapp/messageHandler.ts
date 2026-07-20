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
import {
  handleAddPhotoCommand,
  handleAddPhotoConversation,
  handlePhotoCommand,
  isAddPhotoCommand,
  isPhotoCommand,
} from '../commands/productPhotoCommand.js';
import env from '../config/env.js';
import { isGroupMessage } from '../utils/messageContext.js';
import { markMessageForProcessing } from '../utils/messageDeduplication.js';
import { anonymizeIdentifier } from '../services/logger.js';
import { handleStatusCommand, isStatusCommand } from '../commands/statusCommand.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearAllOperationSessions,
  clearExpiredOperationSessions,
  hasActiveOperationSession,
  isOperationStartCommand,
} from '../utils/operationSessionCoordinator.js';

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
  const messageId = message.id as { fromMe?: boolean } | undefined;
  if (message.fromMe || messageId?.fromMe) {
    return;
  }

  if (!markMessageForProcessing(message)) {
    console.warn('[MESSAGE] Duplicate WhatsApp event ignored.');
    return;
  }

  const body = message.body?.trim() || '';

  if (body && isGroupIdCommand(body)) {
    await handleGroupIdCommand(message);
    return;
  }

  if (!isAuthorizedChat(message)) {
    return;
  }

  console.log('[MESSAGE] Incoming authorized message.', {
    command: identifyCommand(body, message.hasMedia),
    user: anonymizeIdentifier(message.author || message.from),
    chatType: isGroupMessage(message) ? 'group' : 'private',
    hasMedia: message.hasMedia,
  });

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (clearExpiredOperationSessions(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return;
  }

  if (body.toLowerCase() === 'cancelar' && hasActiveOperationSession(userId, chatId)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return;
  }

  // A fresh tire query intentionally abandons every incompatible operation.
  if (body && isPneuCommand(body)) {
    const rawMeasure = body.trim().slice(5).trim();
    await handlePneuCommand(message, rawMeasure);
    return;
  }

  if (isOperationStartCommand(body) && hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  if (await handleAddPhotoConversation(message, body)) {
    return;
  }

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

  if (isStatusCommand(body)) {
    await handleStatusCommand(message);
    return;
  }

  if (isPhotoCommand(body)) {
    await handlePhotoCommand(message, body);
    return;
  }

  if (isAddPhotoCommand(body)) {
    await handleAddPhotoCommand(message, body);
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

function identifyCommand(body: string, hasMedia: boolean): string {
  if (!body) return hasMedia ? 'media' : 'empty';
  return body.trim().split(/\s+/, 1)[0]?.toLowerCase() || 'unknown';
}

export function isAuthorizedChat(message: Message): boolean {
  if (isGroupMessage(message)) {
    return Boolean(env.whatsappOfficialGroupId) && message.from === env.whatsappOfficialGroupId;
  }

  return env.allowPrivateTestMode;
}
