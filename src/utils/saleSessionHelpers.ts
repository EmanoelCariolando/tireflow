import type { QueriedProduct } from './lastQueryStore.js';
import { allocateAmountByWeights } from './saleAllocation.js';
import type { SaleItem, SalePriceType, SaleSession } from './saleSessionStore.js';

export interface PersistedSaleItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
}

export function hasSaleDiscount(session: SaleSession): boolean {
  return Boolean(
    (session.discountPercent !== undefined && session.discountPercent > 0) ||
    (session.discountAmount !== undefined && session.discountAmount > 0)
  );
}

export function getSaleDiscountInCents(
  session: SaleSession,
  originalTotalInCents: number
): number {
  if (session.discountPercent !== undefined && session.discountPercent > 0) {
    return Math.round(originalTotalInCents * session.discountPercent / 100);
  }
  if (session.discountAmount !== undefined && session.discountAmount > 0) {
    return Math.round(session.discountAmount * 100);
  }
  return 0;
}

export function appendPricedSaleItem(
  session: SaleSession,
  priceType: SalePriceType
): SaleSession {
  const unitPrice = priceType === 'À vista' ? session.cashPrice : session.creditPrice;
  const newItem: SaleItem = {
    productId: session.productId,
    reference: session.reference,
    description: session.description,
    quantity: session.quantity,
    cashPrice: session.cashPrice,
    creditPrice: session.creditPrice,
    priceType,
    unitPrice,
    totalValue: session.quantity * unitPrice,
  };
  const items = [...getExplicitSaleItems(session), newItem];
  const originalTotalInCents = items.reduce(
    (total, item) => total + Math.round(item.totalValue * 100),
    0
  );
  const discountInCents = getSaleDiscountInCents(session, originalTotalInCents);
  const totalValue = (originalTotalInCents - discountInCents) / 100;
  const sharedPriceType = items.every((item) => item.priceType === items[0]?.priceType)
    ? items[0]?.priceType
    : undefined;

  return {
    ...session,
    items,
    priceType: sharedPriceType,
    unitPrice,
    totalValue,
    originalTotalValue: hasSaleDiscount(session) ? originalTotalInCents / 100 : undefined,
  };
}

export function getExplicitSaleItems(session: SaleSession): SaleItem[] {
  return session.items ? session.items.map((item) => ({ ...item })) : [];
}

export function getSaleItems(session: SaleSession): SaleItem[] {
  const items = getExplicitSaleItems(session);
  if (items.length > 0) {
    return items;
  }

  if (session.unitPrice === undefined || session.totalValue === undefined) {
    return [];
  }

  const priceType = session.priceType ??
    (session.unitPrice === session.creditPrice ? 'A prazo' : 'À vista');
  const baseTotalValue = session.originalTotalValue ?? session.totalValue;
  return [{
    productId: session.productId,
    reference: session.reference,
    description: session.description,
    quantity: session.quantity,
    cashPrice: session.cashPrice,
    creditPrice: session.creditPrice,
    priceType,
    unitPrice: baseTotalValue / session.quantity,
    totalValue: baseTotalValue,
  }];
}

export function getReservedSaleQuantity(items: SaleItem[], productId: string): number {
  return items
    .filter((item) => item.productId === productId)
    .reduce((total, item) => total + item.quantity, 0);
}

export function adjustAvailableProductsForSaleCart(
  products: QueriedProduct[],
  items: SaleItem[]
): QueriedProduct[] {
  return products
    .map((product) => ({
      ...product,
      stock: Math.max(0, product.stock - getReservedSaleQuantity(items, product.id)),
    }))
    .filter((product) => product.stock > 0);
}

export function buildPersistedSaleItems(session: SaleSession): PersistedSaleItem[] {
  const items = getSaleItems(session);
  const baseTotalsInCents = items.map((item) => Math.round(item.totalValue * 100));
  const allocatedTotalsInCents = allocateAmountByWeights(
    Math.round((session.totalValue ?? 0) * 100),
    baseTotalsInCents
  );

  return items.map((item, index) => {
    const totalValue = allocatedTotalsInCents[index]! / 100;
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: totalValue / item.quantity,
      totalValue,
    };
  });
}
