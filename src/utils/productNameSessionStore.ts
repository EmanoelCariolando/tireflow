import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export interface ProductNameSession {
  userId: string;
  chatId: string;
  productId: string;
  reference: string;
  previousDescription: string;
  newDescription?: string;
  step: 'awaiting_name' | 'awaiting_confirmation' | 'processing';
  updatedAt: number;
}

const sessions = new Map<string, ProductNameSession>();
const keyFor = (userId: string, chatId: string): string => `${chatId}:${userId}`;

export function saveProductNameSession(session: ProductNameSession): void {
  sessions.set(keyFor(session.userId, session.chatId), { ...session, updatedAt: Date.now() });
}

export function hasExpiredProductNameSession(userId: string, chatId: string): boolean {
  const key = keyFor(userId, chatId);
  const session = sessions.get(key);
  if (!session || Date.now() - session.updatedAt <= EMPLOYEE_SESSION_TTL_MS) return false;
  sessions.delete(key);
  return true;
}

export function getProductNameSession(userId: string, chatId: string): ProductNameSession | null {
  if (hasExpiredProductNameSession(userId, chatId)) return null;
  const session = sessions.get(keyFor(userId, chatId));
  return session ? { ...session } : null;
}

export function clearProductNameSession(userId: string, chatId: string): void {
  sessions.delete(keyFor(userId, chatId));
}
