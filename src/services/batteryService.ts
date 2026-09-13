import { BatteryBrand, ProductCategory, type Product } from '@prisma/client';
import { productRepository } from '../repositories/productRepository.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { hasProductImageFile } from './productPhotoStorage.js';

export interface BatterySearchQuery {
  brand: BatteryBrand | null;
  terms: string[];
  label: string;
}

type BatteryProductRow = Pick<
  Product,
  | 'id'
  | 'reference'
  | 'description'
  | 'category'
  | 'batteryBrand'
  | 'stock'
  | 'stockLocation'
  | 'cashPrice'
  | 'creditPrice'
  | 'imagePath'
>;

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)\s*A\s*\/?\s*H\b/g, '$1AH')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function parseBatterySearchQuery(body: string): BatterySearchQuery | null {
  const normalizedBody = normalizeSearchText(body);
  if (!normalizedBody) return null;

  const match = normalizedBody.match(/^BATERIA\s+(\d{2,3})$/);
  if (!match) return null;

  const brand = null;
  const terms = [match[1]!];
  const label = terms[0]!;

  return { brand, terms, label };
}

export function isBatterySearchCommand(body: string): boolean {
  return parseBatterySearchQuery(body) !== null;
}

export function filterBatteryProducts(
  products: BatteryProductRow[],
  query: BatterySearchQuery
): BatteryProductRow[] {
  return products.filter((product) => {
    if (query.brand && product.batteryBrand !== query.brand) return false;

    const haystack = normalizeSearchText(
      `${product.reference} ${product.description} ${product.batteryBrand ?? ''}`
    );
    return query.terms.every((term) => haystack.includes(term));
  });
}

export async function findActiveBatteries(
  query: BatterySearchQuery
): Promise<QueriedProduct[]> {
  const products = filterBatteryProducts(
    await productRepository.findActiveBatteries(),
    query
  );

  return products.map((product) => ({
    id: product.id,
    reference: product.reference,
    description: product.description,
    category: ProductCategory.BATTERY,
    batteryBrand: product.batteryBrand,
    stock: product.stock,
    stockLocation: product.stockLocation,
    cashPrice: Number(product.cashPrice),
    creditPrice: Number(product.creditPrice),
    hasPhoto: hasProductImageFile(product.imagePath),
  }));
}
