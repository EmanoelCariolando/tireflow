import type { Message } from 'whatsapp-web.js';

export type PaymentMethod = 'Dinheiro' | 'PIX' | 'Cartão' | 'Nota';

export type SaleSessionStep =
  | 'awaiting_payment'
  | 'awaiting_photo'
  | 'awaiting_invoice_name'
  | 'awaiting_confirmation'
  | 'processing';

export interface SaleSession {
  userId: string;
  chatId: string;
  step: SaleSessionStep;
  productId: string;
  reference: string;
  description: string;
  quantity: number;
  cashPrice: number;
  creditPrice: number;
  unitPrice?: number;
  totalValue?: number;
  paymentMethod?: PaymentMethod;
  invoiceName?: string;
  receiptMessageId?: string;
  receiptMessage?: Message;
  updatedAt: number;
}

const saleSessions = new Map<string, SaleSession>();
const TTL_MS = 5 * 60 * 1000;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: SaleSession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function saveSaleSession(session: SaleSession): void {
  saleSessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getSaleSession(userId: string, chatId: string): SaleSession | null {
  const key = buildKey(userId, chatId);
  const session = saleSessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    saleSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredSaleSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = saleSessions.get(key);

  if (!session) {
    return false;
  }

  if (!isExpired(session)) {
    return false;
  }

  saleSessions.delete(key);
  return true;
}

export function clearSaleSession(userId: string, chatId: string): void {
  saleSessions.delete(buildKey(userId, chatId));
}
