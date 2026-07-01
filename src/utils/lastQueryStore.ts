/**
 * In-memory store for the last tire consultation per user.
 * 
 * Fase 2: Save last query for 5 minutes to support indexed selection (e.g. venda 1 5).
 * 
 * This will be used in Fase 3, but the storage mechanism is part of Fase 2.
 */

export interface QueriedProduct {
  description: string;
  stock: number;
  cashPrice: number;
  creditPrice: number;
}

interface StoredQuery {
  normalizedMeasure: string;
  products: QueriedProduct[];
  timestamp: number;
}

const lastQueries = new Map<string, StoredQuery>();

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Save the results of a pneu query for a user.
 */
export function saveLastQuery(
  userId: string,
  normalizedMeasure: string,
  products: QueriedProduct[]
): void {
  lastQueries.set(userId, {
    normalizedMeasure,
    products: [...products],
    timestamp: Date.now(),
  });
}

/**
 * Get the last query if it is still valid (< 5 minutes old).
 * Automatically removes expired entries.
 */
export function getLastQuery(userId: string): {
  normalizedMeasure: string;
  products: QueriedProduct[];
} | null {
  const stored = lastQueries.get(userId);
  if (!stored) return null;

  if (Date.now() - stored.timestamp > TTL_MS) {
    lastQueries.delete(userId);
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
export function clearLastQuery(userId: string): void {
  lastQueries.delete(userId);
}
