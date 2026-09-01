export const MAX_PRODUCT_TEXT_LENGTH = 120;

export function normalizeProductDescription(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized.length >= 2 && normalized.length <= MAX_PRODUCT_TEXT_LENGTH
    ? normalized
    : null;
}

export function normalizeProductShortText(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 2 && normalized.length <= MAX_PRODUCT_TEXT_LENGTH
    ? normalized
    : null;
}

export function parseNonNegativeInteger(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseProductRegistrationPrice(value: string): number | null {
  const compact = value.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  let normalized: string;

  if (/^\d+$/.test(compact)) {
    normalized = compact;
  } else if (/^\d+,\d{1,2}$/.test(compact)) {
    normalized = compact.replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(compact)) {
    normalized = compact;
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(/,/g, '');
  } else {
    return null;
  }

  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return Math.round(price * 100) / 100;
}
