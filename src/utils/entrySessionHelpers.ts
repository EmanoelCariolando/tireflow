import type { QueriedProduct } from './lastQueryStore.js';
import type { EntryItem, EntrySession } from './entrySessionStore.js';

export const MAX_ENTRY_INVOICE_NUMBER_LENGTH = 40;

export function orderEntryProductsByStock(products: QueriedProduct[]): QueriedProduct[] {
  const available: QueriedProduct[] = [];
  const zeroStock: QueriedProduct[] = [];

  for (const product of products) {
    (product.stock > 0 ? available : zeroStock).push(product);
  }

  return [...available, ...zeroStock];
}

export function parseAdditionalEntryItemSelection(value: string): number | null {
  const match = value.trim().match(/^(?:entrada\s+)?(\d+)$/i);
  if (!match) {
    return null;
  }

  const optionNumber = Number(match[1]);
  return Number.isInteger(optionNumber) && optionNumber > 0 ? optionNumber : null;
}

export function parseEntryPriceValue(value: string): number | null {
  const trimmed = value.trim();
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return Math.round(price * 100) / 100;
}

export function normalizeEntryInvoiceNumber(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');

  if (
    !normalized ||
    normalized.length > MAX_ENTRY_INVOICE_NUMBER_LENGTH ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ./-]*$/u.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function buildCurrentEntryItem(session: EntrySession): EntryItem | null {
  if (!session.quantity || !session.supplier) {
    return null;
  }

  return {
    productId: session.productId,
    reference: session.reference,
    description: session.description,
    oldCashPrice: session.oldCashPrice,
    oldCreditPrice: session.oldCreditPrice,
    quantity: session.quantity,
    supplier: session.supplier,
    stockLocation: session.stockLocation,
    newCashPrice: session.newCashPrice,
    newCreditPrice: session.newCreditPrice,
  };
}

export function getExplicitEntryItems(session: EntrySession): EntryItem[] {
  return session.items?.map((item) => ({ ...item })) ?? [];
}

export function getEntryItems(session: EntrySession): EntryItem[] {
  const items = getExplicitEntryItems(session);
  if (items.length > 0) {
    return items;
  }

  const currentItem = buildCurrentEntryItem(session);
  return currentItem ? [currentItem] : [];
}
