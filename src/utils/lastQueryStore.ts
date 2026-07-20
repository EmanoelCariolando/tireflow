/**
 * In-memory store for the last tire consultation per user.
 * 
 * Fase 2: Save last query for 5 minutes to support indexed selection (e.g. venda 1 5).
 * 
 * This will be used in Fase 3, but the storage mechanism is part of Fase 2.
 */

export interface QueriedProduct {
  id: string;
  reference: string;
  description: string;
  stock: number;
  cashPrice: number;
  creditPrice: number;
  hasPhoto?: boolean;
}

interface StoredQuery {
  userId: string;
  chatId: string;
  normalizedMeasure: string;
  products: QueriedProduct[];
  timestamp: number;
}

const lastQueries = new Map<string, StoredQuery>();

const TTL_MS = 5 * 60 * 1000; // 5 minutes

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

/**
 * Save the results of a pneu query for a user.
 */
export function saveLastQuery(
  userId: string,
  chatId: string,
  normalizedMeasure: string,
  products: QueriedProduct[]
): void {
  lastQueries.set(buildKey(userId, chatId), {
    userId,
    chatId,
    normalizedMeasure,
    products: [...products],
    timestamp: Date.now(),
  });
}

/**
 * Get the last query if it is still valid (< 5 minutes old).
 * Automatically removes expired entries.
 */
export function getLastQuery(userId: string, chatId: string): {
  normalizedMeasure: string;
  products: QueriedProduct[];
} | null {
  const key = buildKey(userId, chatId);
  const stored = lastQueries.get(key);
  if (!stored) return null;

  if (Date.now() - stored.timestamp > TTL_MS) {
    lastQueries.delete(key);
    return null;
  }

  return {
    normalizedMeasure: stored.normalizedMeasure,
    products: [...stored.products],
  };
}

/**
 * Manually clear a user's last query (useful for future cancel/confirm flows).
 */
export function clearLastQuery(userId: string, chatId?: string): void {
  if (chatId) {
    lastQueries.delete(buildKey(userId, chatId));
    return;
  }

  for (const [key, query] of lastQueries) {
    if (query.userId === userId) lastQueries.delete(key);
  }
}
