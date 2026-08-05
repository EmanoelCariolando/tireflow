export const CREDIT_PRICE_MARKUP_PERCENT = 5.8;

export function calculateCreditPrice(cashPrice: number): number {
  return Math.round(cashPrice * (1 + CREDIT_PRICE_MARKUP_PERCENT / 100) * 100) / 100;
}
