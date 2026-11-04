import type { ReversalRequest, ReturnRequest } from '../services/financialService.js';
import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export type FinancialAction =
  | { kind: 'reversal'; request: ReversalRequest }
  | { kind: 'return'; request: ReturnRequest }
  | { kind: 'close'; period: string; hash: string }
  | { kind: 'paid'; period: string; position: number };

const sessions = new Map<string, { action: FinancialAction; updatedAt: number }>();
const key = (userId: string, chatId: string) => JSON.stringify([userId, chatId]);

export function saveFinancialSession(userId: string, chatId: string, action: FinancialAction): void {
  sessions.set(key(userId, chatId), { action, updatedAt: Date.now() });
}

export function getFinancialSession(userId: string, chatId: string): FinancialAction | null {
  const session = sessions.get(key(userId, chatId));
  if (!session) return null;
  if (Date.now() - session.updatedAt > EMPLOYEE_SESSION_TTL_MS) {
    sessions.delete(key(userId, chatId));
    return null;
  }
  return session.action;
}

export function clearFinancialSession(userId: string, chatId: string): void {
  sessions.delete(key(userId, chatId));
}
