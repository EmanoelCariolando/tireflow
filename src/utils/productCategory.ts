import { ProductCategory } from '@prisma/client';

export type ProductCategoryLike = ProductCategory | 'TIRE' | 'BATTERY' | undefined;

export function isBatteryCategory(category: ProductCategoryLike): boolean {
  return category === ProductCategory.BATTERY;
}

export function getProductIcon(category: ProductCategoryLike): string {
  return isBatteryCategory(category) ? '🔋' : '🛞';
}

export function getProductNoun(
  category: ProductCategoryLike,
  plural = false
): string {
  if (isBatteryCategory(category)) {
    return plural ? 'baterias' : 'bateria';
  }

  return plural ? 'pneus' : 'pneu';
}
