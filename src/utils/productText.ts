export const MAX_PRODUCT_TEXT_LENGTH = 120;

export function normalizeProductDescription(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized.length >= 2 && normalized.length <= MAX_PRODUCT_TEXT_LENGTH
    ? normalized
    : null;
}
