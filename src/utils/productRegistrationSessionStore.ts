export type ProductRegistrationSessionStep =
  | 'awaiting_measure'
  | 'awaiting_description'
  | 'awaiting_initial_stock'
  | 'awaiting_supplier'
  | 'awaiting_cash_price'
  | 'awaiting_location'
  | 'awaiting_confirmation'
  | 'processing';

export interface ProductRegistrationSession {
  userId: string;
  chatId: string;
  step: ProductRegistrationSessionStep;
  reference?: string;
  description?: string;
  initialStock?: number;
  supplier?: string;
  cashPrice?: number;
  creditPrice?: number;
  stockLocation?: string | null;
  updatedAt: number;
}

const productRegistrationSessions = new Map<string, ProductRegistrationSession>();
const TTL_MS = 10 * 60 * 1000;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: ProductRegistrationSession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function saveProductRegistrationSession(session: ProductRegistrationSession): void {
  productRegistrationSessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getProductRegistrationSession(
  userId: string,
  chatId: string
): ProductRegistrationSession | null {
  const key = buildKey(userId, chatId);
  const session = productRegistrationSessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    productRegistrationSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredProductRegistrationSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = productRegistrationSessions.get(key);

  if (!session || !isExpired(session)) {
    return false;
  }

  productRegistrationSessions.delete(key);
  return true;
}

export function clearProductRegistrationSession(userId: string, chatId: string): void {
  productRegistrationSessions.delete(buildKey(userId, chatId));
}
