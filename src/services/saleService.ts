import { PaymentMethod } from '../utils/saleSessionStore.js';

let saleSequence = 1;

export function getUnitPriceForPayment(
  paymentMethod: PaymentMethod,
  cashPrice: number,
  creditPrice: number
): number {
  return paymentMethod === 'Dinheiro' || paymentMethod === 'PIX'
    ? cashPrice
    : creditPrice;
}

export function calculateSaleTotal(quantity: number, unitPrice: number): number {
  return quantity * unitPrice;
}

export function generateFakeSaleCode(): string {
  const code = `#V-${String(saleSequence).padStart(6, '0')}`;
  saleSequence += 1;
  return code;
}
