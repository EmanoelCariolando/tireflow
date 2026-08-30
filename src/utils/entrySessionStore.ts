import type { QueriedProduct } from './lastQueryStore.js';
import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export interface EntryItem {
  productId: string;
  reference: string;
  description: string;
  oldCashPrice: number;
  oldCreditPrice: number;
  quantity: number;
  supplier: string;
  stockLocation?: string;
  newCashPrice?: number;
  newCreditPrice?: number;
}

export type EntrySessionStep =
  | 'awaiting_invoice_number'
  | 'awaiting_quantity'
  | 'awaiting_supplier'
  | 'awaiting_location'
  | 'awaiting_price_decision'
  | 'awaiting_cash_price'
  | 'awaiting_additional_decision'
  | 'awaiting_additional_measure'
  | 'awaiting_additional_item'
  | 'awaiting_confirmation'
  | 'processing';

export interface EntrySession {
  userId: string;
  chatId: string;
  step: EntrySessionStep;
  productId: string;
  reference: string;
  description: string;
  oldCashPrice: number;
  oldCreditPrice: number;
  invoiceName?: string;
  invoiceNumber?: string;
  quantity?: number;
  supplier?: string;
  stockLocation?: string;
  newCashPrice?: number;
  newCreditPrice?: number;
  items?: EntryItem[];
  additionalMeasure?: string;
  additionalProducts?: QueriedProduct[];
  updatedAt: number;
}

const entrySessions = new Map<string, EntrySession>();
const TTL_MS = EMPLOYEE_SESSION_TTL_MS;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: EntrySession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function saveEntrySession(session: EntrySession): void {
  entrySessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getEntrySession(userId: string, chatId: string): EntrySession | null {
  const key = buildKey(userId, chatId);
  const session = entrySessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    entrySessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredEntrySession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = entrySessions.get(key);

  if (!session) {
    return false;
  }

  if (!isExpired(session)) {
    return false;
  }

  entrySessions.delete(key);
  return true;
}

export function clearEntrySession(userId: string, chatId: string): void {
  entrySessions.delete(buildKey(userId, chatId));
}
