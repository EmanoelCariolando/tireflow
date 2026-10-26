import { ProductCategory } from '@prisma/client';

export type ProductCategoryLike = ProductCategory | 'TIRE' | 'BATTERY' | undefined;

export function isBatteryCategory(category: ProductCategoryLike): boolean {
  return category === ProductCategory.BATTERY;
}

export function getProductIcon(category: ProductCategoryLike): string {
  if (isTireFlapCategory(category)) return '🛡️';
  if (isInnerTubeCategory(category)) return '⭕';
  return isBatteryCategory(category) ? '🔋' : '🛞';
}

export function getProductNoun(
  category: ProductCategoryLike,
  plural = false
): string {
  if (isTireFlapCategory(category)) return plural ? 'protetores' : 'protetor';
  if (isInnerTubeCategory(category)) return plural ? 'câmaras de ar' : 'câmara de ar';
  if (isBatteryCategory(category)) {
    return plural ? 'baterias' : 'bateria';
  }

  return plural ? 'pneus' : 'pneu';
}

export function isInnerTubeCategory(category: ProductCategoryLike): boolean {
  return category === ProductCategory.INNER_TUBE || category === ProductCategory.MOTORCYCLE_INNER_TUBE;
}

export function isRetreadedTireCategory(category: ProductCategoryLike): boolean {
  return category === ProductCategory.RETREADED_TIRE || category === ProductCategory.MOTORCYCLE_RETREADED_TIRE;
}

export function isTireFlapCategory(category: ProductCategoryLike): boolean {
  return category === ProductCategory.TIRE_FLAP;
}
