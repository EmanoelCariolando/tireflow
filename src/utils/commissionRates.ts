import { ProductCategory } from '@prisma/client';

export const STANDARD_COMMISSION_PERCENT = 2;
export const DISCOUNTED_COMMISSION_PERCENT = 1;

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
