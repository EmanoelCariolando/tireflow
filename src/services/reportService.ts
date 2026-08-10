import { MovementType } from '@prisma/client';
import type { Movement, Product, User } from '@prisma/client';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { parseStoredPaymentBreakdown } from '../utils/salePayment.js';
import { formatStockLocationLine } from '../utils/stockLocation.js';

type MovementWithRelations = Movement & {
  product: Product;
  user: User;
};

export interface DailyZeroStockSummary {
  reference: string;
  description: string;
  stockLocation: string | null;
}

interface DateRange {
  start: Date;
  end: Date;
}

interface ProductSalesSummary {
  product: Product;
  quantity: number;
  totalValue: number;
}

const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Nota'] as const;
type PaymentTotals = Record<(typeof PAYMENT_METHODS)[number], number>;

interface PaymentTotalSource {
  paymentMethod: string | null;
  paymentDetails: string | null;
  totalValue: unknown;
}

interface TodayReportMovementCounts {
  sale: number;
  entry: number;
  adjustment: number;
  priceChange: number;
}

export interface TodayReportFormatInput {
  referenceDate: Date;
  hasMovements: boolean;
  paymentTotals: PaymentTotals;
  totalRevenue: number;
  movementCounts: TodayReportMovementCounts;
  bestSeller?: {
    reference: string;
    description: string;
    quantity: number;
  };
  zeroStockProducts: DailyZeroStockSummary[];
}

export async function buildLowStockReport(limit?: number): Promise<string> {
  const lowStockProducts = await getLowStockProducts(limit);

  return formatLowStockReport(lowStockProducts);
}

export async function buildLowStockOperationalReport(limit?: number): Promise<{
  report: string;
  products: QueriedProduct[];
}> {
  const lowStockProducts = await getLowStockProducts(limit);

  return {
    report: formatLowStockReport(lowStockProducts),
    products: lowStockProducts.map(mapProductToQueriedProduct),
  };
}

function formatLowStockReport(lowStockProducts: Product[]): string {
  if (lowStockProducts.length === 0) {
    return '✅ *ESTOQUE BAIXO*\nNenhum produto abaixo do mínimo.';
  }

  return [
    '⚠️ *ESTOQUE BAIXO*',
    '',
    ...lowStockProducts.map((product, index) =>
      [
        `${index + 1}️⃣ 🛞 *${product.reference} — ${product.description}*`,
        `📦 Estoque: *${product.stock}*`,
        `⚠️ Mínimo: *${product.minStock}*`,
        formatStockLocationLine(product.stockLocation),
        `💰 À vista: *${formatCurrency(toNumber(product.cashPrice))}*`,
        `💳 A prazo: *${formatCurrency(toNumber(product.creditPrice))}*`,
      ].filter((line): line is string => Boolean(line)).join('\n')
    ),
    '',
    'Ações: *entrada 1* | *ajuste 1* | *preco 1*',
  ].join('\n\n');
}

export async function buildBestSellersReport(limit = 10): Promise<string> {
  const sales = await movementRepository.findByType(MovementType.SALE);
  const bestSellers = summarizeSalesByProduct(sales).slice(0, limit);

  if (bestSellers.length === 0) {
    return '🏆 *MAIS VENDIDOS*\nNenhuma venda registrada.';
  }

  return [
    '🏆 *MAIS VENDIDOS*',
    '',
    ...bestSellers.map((item, index) =>
      [
        `${index + 1}️⃣ 🛞 *${item.product.reference} — ${item.product.description}*`,
        `📦 Vendidos: *${item.quantity}*`,
        `💰 Faturamento: *${formatCurrency(item.totalValue)}*`,
      ].join('\n')
    ),
  ].join('\n\n');
}

export async function buildTodayReport(referenceDate = new Date()): Promise<string> {
  const range = getDayRange(referenceDate);
  const movements = await movementRepository.findByDateRange(range.start, range.end);
  const sales = movements.filter((movement) => movement.type === MovementType.SALE);
  const paymentTotals = calculatePaymentTotals(sales);
  const totalRevenue = sales.reduce(
    (sum, sale) => sum + toNumber(sale.totalValue),
    0
  );
  const bestSeller = summarizeSalesByProduct(sales)[0];
  const movementCounts = getMovementCounts(movements);
  const zeroStockProducts = summarizeDailyZeroStock(movements);

  return formatTodayReport({
    referenceDate,
    hasMovements: movements.length > 0,
    paymentTotals,
    totalRevenue,
    movementCounts,
    zeroStockProducts,
    bestSeller: bestSeller
      ? {
          reference: bestSeller.product.reference,
          description: bestSeller.product.description,
          quantity: bestSeller.quantity,
        }
      : undefined,
  });
}

export function formatTodayReport(input: TodayReportFormatInput): string {
  const lines = [
    '📊 *RELATÓRIO DO DIA*',
    formatDate(input.referenceDate),
    '',
  ];

  if (!input.hasMovements) {
    lines.push('Sem movimentações registradas.', '');
  }

  lines.push(
    `💰 *FATURAMENTO: ${formatCurrency(input.totalRevenue)}*`,
    '',
    '💳 *PAGAMENTOS*',
    `💵 Dinheiro: *${formatCurrency(input.paymentTotals.Dinheiro)}*`,
    `📲 PIX: *${formatCurrency(input.paymentTotals.PIX)}*`,
    `💳 Cartão: *${formatCurrency(input.paymentTotals.Cartão)}*`,
    `🧾 Nota: *${formatCurrency(input.paymentTotals.Nota)}*`,
    '',
    '📊 *MOVIMENTAÇÕES*',
    `🛒 Vendas: *${input.movementCounts.sale}*`,
    `📥 Entradas: *${input.movementCounts.entry}*`,
    `🧮 Ajustes: *${input.movementCounts.adjustment}*`,
    `🏷️ Preços: *${input.movementCounts.priceChange}*`,
    '',
    '🏆 *MAIS VENDIDO*',
    formatBestSeller(input.bestSeller),
    '',
    '⚠️ *ESTOQUE ZERADO NO DIA*',
    ...formatDailyZeroStock(input.zeroStockProducts),
    '',
    '_TireFlow • Relatório automático_'
  );

  return lines.join('\n');
}

async function getLowStockProducts(limit?: number): Promise<Product[]> {
  const products = await productRepository.findActiveForStockReport();
  const lowStockProducts = products.filter((product) => product.stock <= product.minStock);

  return limit === undefined ? lowStockProducts : lowStockProducts.slice(0, limit);
}

function getDayRange(date: Date): DateRange {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

export function calculatePaymentTotals(
  sales: PaymentTotalSource[]
): PaymentTotals {
  const totals = {
    Dinheiro: 0,
    PIX: 0,
    Cartão: 0,
    Nota: 0,
  };

  for (const sale of sales) {
    if (sale.paymentMethod === 'Misto') {
      for (const part of parseStoredPaymentBreakdown(sale.paymentDetails)) {
        totals[part.method] += part.amount;
      }
      continue;
    }

    const method = PAYMENT_METHODS.find((paymentMethod) => paymentMethod === sale.paymentMethod);

    if (method) {
      totals[method] += toNumber(sale.totalValue);
    }
  }

  return totals;
}

function getMovementCounts(movements: MovementWithRelations[]): TodayReportMovementCounts {
  const sales = movements.filter((movement) => movement.type === MovementType.SALE);
  return {
    sale: new Set(sales.map(getSaleGroupKey)).size,
    entry: movements.filter((movement) => movement.type === MovementType.ENTRY).length,
    adjustment: movements.filter((movement) => movement.type === MovementType.ADJUSTMENT).length,
    priceChange: movements.filter((movement) => movement.type === MovementType.PRICE_CHANGE).length,
  };
}

function getSaleGroupKey(sale: MovementWithRelations): string {
  return sale.saleGroupCode || sale.code;
}

function summarizeSalesByProduct(sales: MovementWithRelations[]): ProductSalesSummary[] {
  const summary = new Map<string, ProductSalesSummary>();

  for (const sale of sales) {
    const current = summary.get(sale.productId);
    const quantity = sale.quantity ?? 0;
    const totalValue = toNumber(sale.totalValue);

    if (!current) {
      summary.set(sale.productId, {
        product: sale.product,
        quantity,
        totalValue,
      });
      continue;
    }

    current.quantity += quantity;
    current.totalValue += totalValue;
  }

  return [...summary.values()].sort((a, b) => {
    if (b.quantity !== a.quantity) {
      return b.quantity - a.quantity;
    }

    return b.totalValue - a.totalValue;
  });
}

export function summarizeDailyZeroStock(
  movements: MovementWithRelations[]
): DailyZeroStockSummary[] {
  const stockMovementsByProduct = new Map<string, MovementWithRelations[]>();

  for (const movement of movements) {
    if (movement.previousStock === null || movement.newStock === null) {
      continue;
    }

    const productMovements = stockMovementsByProduct.get(movement.productId) ?? [];
    productMovements.push(movement);
    stockMovementsByProduct.set(movement.productId, productMovements);
  }

  const result: DailyZeroStockSummary[] = [];
  for (const productMovements of stockMovementsByProduct.values()) {
    const orderedMovements = [...productMovements].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
    );
    const zeroEvent = orderedMovements.find(
      (movement) => (movement.previousStock ?? 0) > 0 && movement.newStock === 0
    );

    if (!zeroEvent) {
      continue;
    }

    result.push({
      reference: zeroEvent.product.reference,
      description: zeroEvent.product.description,
      stockLocation: zeroEvent.product.stockLocation,
    });
  }

  return result.sort((left, right) => left.reference.localeCompare(right.reference, 'pt-BR'));
}

function formatBestSeller(bestSeller: TodayReportFormatInput['bestSeller']): string {
  if (!bestSeller || bestSeller.quantity <= 0) {
    return 'Nenhum produto vendido hoje.';
  }

  return [
    `🛞 *${bestSeller.reference} — ${bestSeller.description}*`,
    `📦 Quantidade: *${bestSeller.quantity} unidades*`,
  ].join('\n');
}

function formatDailyZeroStock(products: DailyZeroStockSummary[]): string[] {
  if (products.length === 0) {
    return ['Nenhum pneu ficou com estoque 0.'];
  }

  return products.flatMap((product) => {
    const locationLine = formatStockLocationLine(product.stockLocation);
    return [
      `🔴 *${product.reference}* — *${product.description}*`,
      ...(locationLine ? [locationLine] : []),
    ];
  });
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function mapProductToQueriedProduct(product: Product): QueriedProduct {
  return {
    id: product.id,
    reference: product.reference,
    description: product.description,
    stock: product.stock,
    stockLocation: product.stockLocation,
    cashPrice: toNumber(product.cashPrice),
    creditPrice: toNumber(product.creditPrice),
  };
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }

  return Number(value ?? 0);
}
