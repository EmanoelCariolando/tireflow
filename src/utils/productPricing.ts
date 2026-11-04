import { Prisma } from '@prisma/client';

export const CREDIT_PRICE_MARKUP_PERCENT = 5.8;

export function calculateCreditPrice(cashPrice: number): number {
  return Math.round(cashPrice * (1 + CREDIT_PRICE_MARKUP_PERCENT / 100) * 100) / 100;
}

export function calculateTenInstallmentPrice(cashPrice: number | string | Prisma.Decimal): number {
  return new Prisma.Decimal(cashPrice).mul('1.092')
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/** Preserve independently imported 10X prices until the cash price actually changes. */
export function getTenInstallmentPriceUpdate(
  previousCashPrice: number | string | Prisma.Decimal,
  cashPrice: number | string | Prisma.Decimal
): { tenInstallmentPrice?: number } {
  return new Prisma.Decimal(previousCashPrice).equals(cashPrice)
    ? {}
    : { tenInstallmentPrice: calculateTenInstallmentPrice(cashPrice) };
}
