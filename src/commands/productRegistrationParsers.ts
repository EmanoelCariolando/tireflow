import { MAX_PRODUCT_TEXT_LENGTH } from '../utils/productText.js';
export { parseEntryPriceValue as parseProductRegistrationPrice } from '../utils/entrySessionHelpers.js';
export { MAX_PRODUCT_TEXT_LENGTH, normalizeProductDescription } from '../utils/productText.js';
export { parseNonNegativeInteger } from '../utils/stockQuantity.js';

export function normalizeProductShortText(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 2 && normalized.length <= MAX_PRODUCT_TEXT_LENGTH
    ? normalized
    : null;
}
