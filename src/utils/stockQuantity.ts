// Prisma Int fields use signed 32-bit integers, including balances after an increment.
export const MAX_STOCK_QUANTITY = 2_147_483_647;

export function isValidStockQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_STOCK_QUANTITY;
}

export function parseNonNegativeInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return isValidStockQuantity(parsed) ? parsed : null;
}
