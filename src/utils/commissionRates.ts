import { ProductCategory } from '@prisma/client';

export const STANDARD_COMMISSION_PERCENT = 2;
export const DISCOUNTED_COMMISSION_PERCENT = 1;

export function getSaleCommissionPercent(
  sale: {
    paymentMethod: string;
    isCityHallSale?: boolean;
    totalValue: number;
    originalTotalValue?: number;
    discountAmount?: number;
    discountPercent?: number;
  },
  pendingTotalValue?: number
): number {
  if (sale.paymentMethod === 'Nota' && sale.isCityHallSale === true) return 0;
  const finalTotalInCents = Math.round(sale.totalValue * 100);
  const hasDiscount = (sale.discountAmount ?? 0) > 0 || (sale.discountPercent ?? 0) > 0 ||
    (sale.originalTotalValue !== undefined && Math.round(sale.originalTotalValue * 100) > finalTotalInCents) ||
    (pendingTotalValue !== undefined && Math.round(pendingTotalValue * 100) > finalTotalInCents);
  return hasDiscount ? DISCOUNTED_COMMISSION_PERCENT : STANDARD_COMMISSION_PERCENT;
}

export function getCommissionPercentForCategory(
  category: ProductCategory | undefined,
  commissionPercent = STANDARD_COMMISSION_PERCENT
): number {
  if (commissionPercent === 0) return 0;

  switch (category) {
    case ProductCategory.BATTERY:
    case ProductCategory.INNER_TUBE:
    case ProductCategory.MOTORCYCLE_INNER_TUBE:
    case ProductCategory.TIRE_FLAP:
      return DISCOUNTED_COMMISSION_PERCENT;
    default:
      return commissionPercent;
  }
}
