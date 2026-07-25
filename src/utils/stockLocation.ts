import env from '../config/env.js';

const STOCK_LOCATION_PATTERN = /^[A-Z0-9][A-Z0-9_+-]{0,19}$/;

export function normalizeStockLocation(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() || '';
  return normalized && STOCK_LOCATION_PATTERN.test(normalized) ? normalized : null;
}

export function formatStockLocationLine(
  stockLocation: string | null | undefined,
  enabled = env.inventoryLocationsEnabled
): string | null {
  const normalized = normalizeStockLocation(stockLocation);
  return enabled && normalized ? `📍 Local: ${normalized}` : null;
}
