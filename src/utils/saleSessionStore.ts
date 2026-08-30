import type { Message } from 'whatsapp-web.js';
import type { QueriedProduct } from './lastQueryStore.js';
import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export type MixedPaymentMethod = 'Dinheiro' | 'PIX' | 'Cartão';
export type ReceiptPaymentMethod = MixedPaymentMethod | 'Nota';
export type PaymentMethod = MixedPaymentMethod | 'Nota' | 'Misto';
export type SalePriceType = 'À vista' | 'A prazo';

export interface PaymentBreakdownPart {
  method: MixedPaymentMethod;
  amount: number;
}

export interface SaleReceipt {
  paymentMethod: ReceiptPaymentMethod;
  messageId: string;
  message?: Message;
}

export interface SaleItem {
  productId: string;
  reference: string;
  description: string;
  quantity: number;
  cashPrice: number;
  creditPrice: number;
  priceType: SalePriceType;
  unitPrice: number;
  totalValue: number;
}

export type SaleSessionStep =
  | 'awaiting_payment'
  | 'awaiting_price_type'
  | 'awaiting_additional_measure'
  | 'awaiting_additional_item'
  | 'awaiting_additional_quantity'
  | 'awaiting_discount_type'
  | 'awaiting_discount_value'
  | 'awaiting_discount_confirmation'
  | 'awaiting_mixed_methods'
  | 'awaiting_mixed_amount'
  | 'awaiting_photo'
  | 'awaiting_transfer_city'
  | 'awaiting_city_hall_confirmation'
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
  priceType?: SalePriceType;
  discountPercent?: number;
  discountAmount?: number;
  pendingDiscountType?: 'percent' | 'amount';
  originalTotalValue?: number;
  paymentMethod?: PaymentMethod;
  mixedPaymentMethods?: MixedPaymentMethod[];
  mixedAmountMethod?: MixedPaymentMethod;
  paymentBreakdown?: PaymentBreakdownPart[];
  pendingReceiptMethods?: ReceiptPaymentMethod[];
  receipts?: SaleReceipt[];
  isTransferSale?: boolean;
  transferCity?: string;
  isCityHallSale?: boolean;
  invoiceName?: string;
  items?: SaleItem[];
  additionalMeasure?: string;
  additionalProducts?: QueriedProduct[];
  additionalProduct?: QueriedProduct;
  updatedAt: number;
}

const saleSessions = new Map<string, SaleSession>();
const TTL_MS = EMPLOYEE_SESSION_TTL_MS;

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
