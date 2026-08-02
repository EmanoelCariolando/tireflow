import type {
  MixedPaymentMethod,
  PaymentBreakdownPart,
} from './saleSessionStore.js';

const MIXED_METHOD_BY_VALUE: Record<string, MixedPaymentMethod> = {
  '1': 'Dinheiro',
  dinheiro: 'Dinheiro',
  '2': 'PIX',
  pix: 'PIX',
  '3': 'Cartão',
  cartao: 'Cartão',
};

const IGNORED_MIXED_SELECTION_TOKENS = new Set(['e']);

export function parseMixedPaymentMethods(value: string): MixedPaymentMethod[] | null {
  const tokens = normalizeText(value)
    .replace(/[,+/&;-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !IGNORED_MIXED_SELECTION_TOKENS.has(token));

  if (tokens.length !== 2) {
    return null;
  }

  const methods = tokens.map((token) => MIXED_METHOD_BY_VALUE[token]);

  if (methods.some((method) => !method)) {
    return null;
  }

  const uniqueMethods = [...new Set(methods)] as MixedPaymentMethod[];
  return uniqueMethods.length === 2 ? uniqueMethods : null;
}

export function parseCurrencyToCents(value: string): number | null {
  let normalized = value
    .trim()
    .replace(/\s|\u00a0/g, '')
    .replace(/^r\$/i, '');

  if (!normalized || !/^\d+(?:[.,]\d+)*$/.test(normalized)) {
    return null;
  }

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    if (!/^\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(normalized)) {
      return null;
    }
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    if (!/^\d+(?:,\d{1,2})?$/.test(normalized)) {
      return null;
    }
    normalized = normalized.replace(',', '.');
  } else if (hasDot) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    } else if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
      return null;
    }
  }

  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100))
    ? Math.round(amount * 100)
    : null;
}

export function chooseMixedAmountMethod(
  methods: MixedPaymentMethod[]
): MixedPaymentMethod | null {
  if (methods.includes('PIX')) {
    return 'PIX';
  }

  if (methods.includes('Cartão')) {
    return 'Cartão';
  }

  return null;
}

export function buildPaymentBreakdown(
  methods: MixedPaymentMethod[],
  enteredMethod: MixedPaymentMethod,
  enteredAmountInCents: number,
  totalInCents: number
): PaymentBreakdownPart[] | null {
  if (
    methods.length !== 2 ||
    new Set(methods).size !== 2 ||
    !methods.includes(enteredMethod) ||
    enteredAmountInCents <= 0 ||
    enteredAmountInCents >= totalInCents
  ) {
    return null;
  }

  const remainingMethod = methods.find((method) => method !== enteredMethod);

  if (!remainingMethod) {
    return null;
  }

  return [
    { method: enteredMethod, amount: enteredAmountInCents / 100 },
    { method: remainingMethod, amount: (totalInCents - enteredAmountInCents) / 100 },
  ];
}

export function serializePaymentBreakdown(parts: PaymentBreakdownPart[] | undefined): string | undefined {
  if (!parts) {
    return undefined;
  }

  return JSON.stringify(parts);
}

export function parseStoredPaymentBreakdown(value: string | null | undefined): PaymentBreakdownPart[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const parts = parsed.filter(isPaymentBreakdownPart);
    return parts.length === parsed.length ? parts : [];
  } catch {
    return [];
  }
}

function isPaymentBreakdownPart(value: unknown): value is PaymentBreakdownPart {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { method?: unknown; amount?: unknown };
  return (
    (candidate.method === 'Dinheiro' ||
      candidate.method === 'PIX' ||
      candidate.method === 'Cartão') &&
    typeof candidate.amount === 'number' &&
    Number.isFinite(candidate.amount) &&
    candidate.amount > 0
  );
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
