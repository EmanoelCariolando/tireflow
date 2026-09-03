import { parseBinaryResponse } from '../utils/binaryResponse.js';
import type { PaymentMethod, SalePriceType } from '../utils/saleSessionStore.js';

export const TRANSFER_PAYMENT_ENABLED = false;

export interface AdditionalSaleItemSelection {
  optionNumber: number;
  quantity?: number;
}

export function parseCityHallResponse(value: string): boolean | null {
  const hasCommission = parseBinaryResponse(value);

  // The stored flag represents a city-hall/no-commission sale, the inverse of this question.
  return hasCommission === null ? null : !hasCommission;
}

export function parsePaymentMethod(
  value: string
): PaymentMethod | 'Transferência' | null {
  const normalized = removeAccents(value);

  if (normalized === '1' || normalized === 'dinheiro') return 'Dinheiro';
  if (normalized === '2' || normalized === 'pix') return 'PIX';
  if (normalized === '3' || normalized === 'cartao') return 'Cartão';
  if (normalized === '4' || normalized === 'nota') return 'Nota';
  if (normalized === '5' || normalized === 'misto' || normalized === 'pagamento misto') {
    return 'Misto';
  }
  if (normalized === '8' || normalized === 'pendencia' || normalized === 'pendente') {
    return 'Pendência';
  }
  if (
    TRANSFER_PAYMENT_ENABLED &&
    (normalized === '9' || normalized === 'transferencia')
  ) {
    return 'Transferência';
  }

  return null;
}

export function isDiscountSelection(value: string): boolean {
  const normalized = removeAccents(value);
  return normalized === '6' || normalized === 'desconto';
}

export function parseDiscountType(value: string): 'percent' | 'amount' | null {
  const normalized = removeAccents(value);
  if (normalized === '1' || normalized === '%' || normalized === 'desconto %') {
    return 'percent';
  }
  if (normalized === '2' || normalized === 'r$' || normalized === 'desconto r$') {
    return 'amount';
  }
  return null;
}

export function parseDiscountPercent(value: string): number | null {
  const normalized = value.trim().replace(/%$/, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const percent = Number(normalized);
  return Number.isFinite(percent) && percent > 0 && percent < 100
    ? Math.round(percent * 100) / 100
    : null;
}

export function isAddItemSelection(value: string): boolean {
  const normalized = removeAccents(value);
  return (
    normalized === '7' ||
    normalized === 'adicionar outro pneu' ||
    normalized === 'outro pneu' ||
    normalized === 'vender mais'
  );
}

export function parseAdditionalItemSelection(
  value: string
): AdditionalSaleItemSelection | null {
  const match = value.trim().match(/^(?:venda\s+)?(\d+)(?:\s+(\d+))?$/i);
  if (!match) {
    return null;
  }

  const optionNumber = Number(match[1]);
  const quantity = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    return null;
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
    return null;
  }
  return { optionNumber, quantity };
}

export function parsePriceType(value: string): SalePriceType | null {
  const normalized = removeAccents(value).replace(/\s+/g, ' ').trim();

  if (normalized === '1' || normalized === 'avista' || normalized === 'a vista') {
    return 'À vista';
  }
  if (normalized === '2' || normalized === 'prazo' || normalized === 'a prazo') {
    return 'A prazo';
  }
  return null;
}

function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
