import env from '../config/env.js';

const STOCK_LOCATION_PATTERN = /^[A-Z0-9][A-Z0-9_+-]{0,19}$/;
const STOCK_LOCATION_SEPARATOR = ' / ';
const STOCK_LOCATION_CHOICES = {
  '1': 'W3',
  '2': 'PMAIS',
  '3': 'CG',
} as const;

export function parseStockLocationChoice(value: string): string | null {
  const trimmed = value.trim();
  const numberedChoice = STOCK_LOCATION_CHOICES[trimmed as keyof typeof STOCK_LOCATION_CHOICES];
  if (numberedChoice) {
    return numberedChoice;
  }

  const namedChoice = trimmed.toUpperCase();
  return Object.values(STOCK_LOCATION_CHOICES).includes(
    namedChoice as (typeof STOCK_LOCATION_CHOICES)[keyof typeof STOCK_LOCATION_CHOICES]
  )
    ? namedChoice
    : null;
}

export function normalizeSingleStockLocation(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim().toUpperCase() || '';
  return normalized && STOCK_LOCATION_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeStockLocation(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() || '';
  if (!normalized) {
    return null;
  }

  const locations = normalized.split(/\s*\/\s*/);
  if (
    locations.length > 2 ||
    locations.some((location) => !normalizeSingleStockLocation(location)) ||
    new Set(locations).size !== locations.length
  ) {
    return null;
  }

  return locations.join(STOCK_LOCATION_SEPARATOR);
}

export function combineStockLocations(firstLocation: string, secondLocation?: string): string | null {
  return normalizeStockLocation(
    secondLocation ? `${firstLocation}${STOCK_LOCATION_SEPARATOR}${secondLocation}` : firstLocation
  );
}

export function formatStockLocationLine(
  stockLocation: string | null | undefined,
  enabled = env.inventoryLocationsEnabled
): string | null {
  const normalized = normalizeStockLocation(stockLocation);
  return enabled && normalized ? `📍 Local: *${normalized}*` : null;
}
