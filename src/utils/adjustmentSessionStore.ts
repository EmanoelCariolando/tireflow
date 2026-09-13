import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';
import type { ProductCategory } from '@prisma/client';

export type AdjustmentSessionStep =
  | 'awaiting_adjustment_type'
  | 'awaiting_new_stock'
  | 'awaiting_quantity'
  | 'awaiting_transfer_measure'
  | 'awaiting_transfer_product'
  | 'awaiting_reason'
  | 'awaiting_confirmation'
  | 'processing';

export type AdjustmentKind = 'set' | 'add' | 'remove' | 'transfer';

export interface AdjustmentTransferCandidate {
  id: string;
  reference: string;
  description: string;
  category?: ProductCategory;
  stock: number;
}

export interface AdjustmentSession {
  userId: string;
  chatId: string;
  step: AdjustmentSessionStep;
  productId: string;
  reference: string;
  description: string;
  category?: ProductCategory;
  previousStock: number;
  kind?: AdjustmentKind;
  quantity?: number;
  newStock?: number;
  transferCandidates?: AdjustmentTransferCandidate[];
  targetProductId?: string;
  targetReference?: string;
  targetDescription?: string;
  targetPreviousStock?: number;
  targetNewStock?: number;
  reason?: string;
  updatedAt: number;
}

const adjustmentSessions = new Map<string, AdjustmentSession>();
const TTL_MS = EMPLOYEE_SESSION_TTL_MS;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: AdjustmentSession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function saveAdjustmentSession(session: AdjustmentSession): void {
  adjustmentSessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getAdjustmentSession(userId: string, chatId: string): AdjustmentSession | null {
  const key = buildKey(userId, chatId);
  const session = adjustmentSessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    adjustmentSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredAdjustmentSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = adjustmentSessions.get(key);

  if (!session) {
    return false;
  }

  if (!isExpired(session)) {
    return false;
  }

  adjustmentSessions.delete(key);
  return true;
}

export function clearAdjustmentSession(userId: string, chatId: string): void {
  adjustmentSessions.delete(buildKey(userId, chatId));
}
