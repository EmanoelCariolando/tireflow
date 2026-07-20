import { clearSaleSession, getSaleSession, hasExpiredSaleSession } from './saleSessionStore.js';
import { clearEntrySession, getEntrySession, hasExpiredEntrySession } from './entrySessionStore.js';
import {
  clearAdjustmentSession,
  getAdjustmentSession,
  hasExpiredAdjustmentSession,
} from './adjustmentSessionStore.js';
import { clearPriceSession, getPriceSession, hasExpiredPriceSession } from './priceSessionStore.js';
import {
  clearAddPhotoSession,
  getAddPhotoSession,
  hasExpiredAddPhotoSession,
} from './addPhotoSessionStore.js';

export function hasActiveOperationSession(userId: string, chatId: string): boolean {
  return Boolean(
    getSaleSession(userId, chatId) ||
      getEntrySession(userId, chatId) ||
      getAdjustmentSession(userId, chatId) ||
      getPriceSession(userId, chatId) ||
      getAddPhotoSession(userId, chatId)
  );
}

export function clearAllOperationSessions(userId: string, chatId: string): void {
  clearSaleSession(userId, chatId);
  clearEntrySession(userId, chatId);
  clearAdjustmentSession(userId, chatId);
  clearPriceSession(userId, chatId);
  clearAddPhotoSession(userId, chatId);
}

export function clearExpiredOperationSessions(userId: string, chatId: string): boolean {
  const expired = [
    hasExpiredSaleSession(userId, chatId),
    hasExpiredEntrySession(userId, chatId),
    hasExpiredAdjustmentSession(userId, chatId),
    hasExpiredPriceSession(userId, chatId),
    hasExpiredAddPhotoSession(userId, chatId),
  ];
  return expired.some(Boolean);
}

export function isOperationStartCommand(body: string): boolean {
  return /^(venda\s+\d+\s+\d+|entrada\s+\d+|ajuste\s+\d+|preco\s+\d+|addfoto\s+\d+)$/i.test(
    body.trim()
  );
}
