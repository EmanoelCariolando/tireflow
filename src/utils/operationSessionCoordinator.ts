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
import {
  clearLocationSession,
  getLocationSession,
  hasExpiredLocationSession,
} from './locationSessionStore.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
  hasExpiredProductRegistrationSession,
} from './productRegistrationSessionStore.js';
import { clearProductActionSession } from './productActionSessionStore.js';
import {
  clearProductNameSession, getProductNameSession, hasExpiredProductNameSession,
} from './productNameSessionStore.js';
import {
  clearPendingSaleResolutionSession,
  getPendingSaleResolutionSession,
  hasExpiredPendingSaleResolutionSession,
} from './pendingSaleSessionStore.js';
import {
  clearMonthlyInventoryReportSession,
  getMonthlyInventoryReportSession,
  hasExpiredMonthlyInventoryReportSession,
} from './monthlyInventoryReportSessionStore.js';
import {
  clearMonthlyCommissionReportSession,
  getMonthlyCommissionReportSession,
  hasExpiredMonthlyCommissionReportSession,
} from './monthlyCommissionReportSessionStore.js';

export function hasActiveOperationSession(userId: string, chatId: string): boolean {
  return Boolean(
    getProductNameSession(userId, chatId) ||
      getSaleSession(userId, chatId) ||
      getEntrySession(userId, chatId) ||
      getAdjustmentSession(userId, chatId) ||
      getPriceSession(userId, chatId) ||
      getAddPhotoSession(userId, chatId) ||
      getLocationSession(userId, chatId) ||
      getProductRegistrationSession(userId, chatId) ||
      getPendingSaleResolutionSession(userId, chatId) ||
      getMonthlyInventoryReportSession(userId, chatId) ||
      getMonthlyCommissionReportSession(userId, chatId)
  );
}

export function clearAllOperationSessions(userId: string, chatId: string): void {
  clearProductActionSession(userId, chatId);
  clearProductNameSession(userId, chatId);
  clearSaleSession(userId, chatId);
  clearEntrySession(userId, chatId);
  clearAdjustmentSession(userId, chatId);
  clearPriceSession(userId, chatId);
  clearAddPhotoSession(userId, chatId);
  clearLocationSession(userId, chatId);
  clearProductRegistrationSession(userId, chatId);
  clearPendingSaleResolutionSession(userId, chatId);
  clearMonthlyInventoryReportSession(userId, chatId);
  clearMonthlyCommissionReportSession(userId, chatId);
}

export function clearExpiredOperationSessions(userId: string, chatId: string): boolean {
  const expired = [
    hasExpiredProductNameSession(userId, chatId),
    hasExpiredSaleSession(userId, chatId),
    hasExpiredEntrySession(userId, chatId),
    hasExpiredAdjustmentSession(userId, chatId),
    hasExpiredPriceSession(userId, chatId),
    hasExpiredAddPhotoSession(userId, chatId),
    hasExpiredLocationSession(userId, chatId),
    hasExpiredProductRegistrationSession(userId, chatId),
    hasExpiredPendingSaleResolutionSession(userId, chatId),
    hasExpiredMonthlyInventoryReportSession(userId, chatId),
    hasExpiredMonthlyCommissionReportSession(userId, chatId),
  ];
  return expired.some(Boolean);
}

export function isOperationStartCommand(body: string): boolean {
  return /^(pendentes?|relat[oó]rio\s+(mensal|estoque|comiss[oõ]es)|venda\s+\d+\s+\d+|entrada\s+\d+|ajuste\s+\d+|pre[cç]o\s+\d+|addfoto\s+\d+|local\s+\d+|nome\s+\d+|(cadastrar|adicionar)\s+pneu)$/i.test(
    body.trim()
  );
}

export function isNewOperationConversationCommand(body: string): boolean {
  return /^(pendentes?|venda|entrada|ajuste|pre[cç]o|local|nome)\b/i.test(body.trim());
}

export function isProductRegistrationNavigationCommand(body: string): boolean {
  return /^(menu|venda|entrada|ajuste|pre[cç]o|local|nome|addfoto|cadastrar\s+pneu|adicionar\s+pneu)\b/i.test(
    body.trim()
  );
}
