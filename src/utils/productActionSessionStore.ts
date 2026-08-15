export type ProductActionSessionStep =
  | 'awaiting_product'
  | 'awaiting_action'
  | 'awaiting_sale_quantity';

export type ProductActionSessionMode = 'standard' | 'zero_stock';

export interface ProductActionSession {
  userId: string;
  chatId: string;
  step: ProductActionSessionStep;
  optionNumber?: number;
  mode: ProductActionSessionMode;
  expiresAt: number;
}

export const PRODUCT_ACTION_SESSION_TTL_MS = 9 * 60 * 1000;

const productActionSessions = new Map<string, ProductActionSession>();

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

export function saveProductActionSession(
  userId: string,
  chatId: string,
  step: ProductActionSessionStep,
  optionNumber?: number,
  mode: ProductActionSessionMode = 'standard'
): void {
  productActionSessions.set(buildKey(userId, chatId), {
    userId,
    chatId,
    step,
    optionNumber,
    mode,
    expiresAt: Date.now() + PRODUCT_ACTION_SESSION_TTL_MS,
  });
}

export function getProductActionSession(
  userId: string,
  chatId: string
): ProductActionSession | null {
  const key = buildKey(userId, chatId);
  const session = productActionSessions.get(key);

  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    productActionSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredProductActionSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = productActionSessions.get(key);

  if (!session || session.expiresAt >= Date.now()) {
    return false;
  }

  productActionSessions.delete(key);
  return true;
}

export function clearProductActionSession(userId: string, chatId: string): void {
  productActionSessions.delete(buildKey(userId, chatId));
}
