export type PriceSessionStep =
  | 'awaiting_cash_price'
  | 'awaiting_credit_price'
  | 'awaiting_confirmation'
  | 'processing';

export interface PriceSession {
  userId: string;
  chatId: string;
  step: PriceSessionStep;
  productId: string;
  reference: string;
  description: string;
  stock: number;
  oldCashPrice: number;
  oldCreditPrice: number;
  newCashPrice?: number;
  newCreditPrice?: number;
  updatedAt: number;
}

const priceSessions = new Map<string, PriceSession>();
const TTL_MS = 5 * 60 * 1000;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: PriceSession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function savePriceSession(session: PriceSession): void {
  priceSessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getPriceSession(userId: string, chatId: string): PriceSession | null {
  const key = buildKey(userId, chatId);
  const session = priceSessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    priceSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredPriceSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = priceSessions.get(key);

  if (!session) {
    return false;
  }

  if (!isExpired(session)) {
    return false;
  }

  priceSessions.delete(key);
  return true;
}

export function clearPriceSession(userId: string, chatId: string): void {
  priceSessions.delete(buildKey(userId, chatId));
}
