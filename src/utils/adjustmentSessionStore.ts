export type AdjustmentSessionStep =
  | 'awaiting_new_stock'
  | 'awaiting_reason'
  | 'awaiting_confirmation'
  | 'processing';

export interface AdjustmentSession {
  userId: string;
  chatId: string;
  step: AdjustmentSessionStep;
  productId: string;
  reference: string;
  description: string;
  previousStock: number;
  newStock?: number;
  reason?: string;
  updatedAt: number;
}

const adjustmentSessions = new Map<string, AdjustmentSession>();
const TTL_MS = 5 * 60 * 1000;

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
