import { MovementType } from '@prisma/client';
import type { Movement, Product, User } from '@prisma/client';
import env from '../config/env.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { parseStoredPaymentBreakdown } from '../utils/salePayment.js';
import {
  buildMonthlyInventoryPdf,
  getMonthlyInventoryPdfFileName,
} from './monthlyInventoryPdfService.js';

export type MonthlyMovementWithRelations = Movement & {
  product: Product;
  user: User;
};

type PaymentTotals = Record<'Dinheiro' | 'PIX' | 'Cartão' | 'Nota', number>;

interface MonthlyMovementCounts {
  sale: number;
  entry: number;
  adjustment: number;
  priceChange: number;
}

interface SellerSummary {
  name: string;
  saleCount: number;
  quantity: number;
  totalValue: number;
  commissionBase: number;
  commission: number;
}

interface ProductSummary {
  reference: string;
  description: string;
  quantity: number;
  totalValue: number;
}

interface ZeroStockSummary {
  reference: string;
  description: string;
  stockLocation: string | null;
  soldQuantity: number;
  zeroedAt: Date;
  endedAtZero: boolean;
  replenishedAt?: Date;
}

export interface MonthlyPeriod {
  start: Date;
  end: Date;
  key: string;
}

export interface MonthlyReportFormatInput {
  period: MonthlyPeriod;
  commissionPercent: number;
  paymentTotals: PaymentTotals;
  totalRevenue: number;
  previousMonthRevenue: number;
  saleCount: number;
  unitsSold: number;
  previousMonthUnitsSold: number;
  movementCounts: MonthlyMovementCounts;
  sellers: SellerSummary[];
  bestSellers: ProductSummary[];
  zeroStockProducts: ZeroStockSummary[];
  showStockLocations: boolean;
}

export interface CommissionReportFormatInput {
  period: MonthlyPeriod;
  commissionPercent: number;
  sellers: SellerSummary[];
}

export interface MonthlyReportDelivery {
  financialMessage: string;
  pdfBuffer: Buffer;
  pdfFileName: string;
}

const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão', 'Nota'] as const;

export async function buildMonthlyReport(
  referenceDate = new Date(),
  commissionPercent = env.monthlyCommissionPercent
): Promise<string[]> {
  const period = getPreviousMonthPeriod(referenceDate);
  const previousPeriod = getPreviousMonthPeriod(period.start);
  const [movements, previousMovements] = await Promise.all([
    movementRepository.findByDateRange(period.start, period.end),
    movementRepository.findByDateRange(previousPeriod.start, previousPeriod.end),
  ]);

  return formatMonthlyReport(
    summarizeMonthlyReport(
      period,
      movements,
      previousMovements,
      commissionPercent,
      env.inventoryLocationsEnabled
    )
  );
}

export async function buildMonthlyReportDelivery(
  referenceDate = new Date(),
  commissionPercent = env.monthlyCommissionPercent
): Promise<MonthlyReportDelivery> {
  const period = getPreviousMonthPeriod(referenceDate);
  const previousPeriod = getPreviousMonthPeriod(period.start);
  const [movements, previousMovements, products] = await Promise.all([
    movementRepository.findByDateRange(period.start, period.end),
    movementRepository.findByDateRange(previousPeriod.start, previousPeriod.end),
    productRepository.findActiveWithPositiveStock(),
  ]);
  const report = summarizeMonthlyReport(
    period,
    movements,
    previousMovements,
    commissionPercent,
    env.inventoryLocationsEnabled
  );

  return {
    financialMessage: formatMonthlyReport(report)[0]!,
    pdfBuffer: await buildMonthlyInventoryPdf({
      report,
      products,
      branchName: env.branchName,
      generatedAt: referenceDate,
    }),
    pdfFileName: getMonthlyInventoryPdfFileName(period.key),
  };
}

export async function buildCommissionReport(
  referenceDate = new Date(),
  commissionPercent = env.monthlyCommissionPercent
): Promise<string> {
  const period = getCommissionPeriod(referenceDate);
  const movements = await movementRepository.findByDateRange(period.start, period.end);
  return formatCommissionReport(
    summarizeCommissionReport(period, movements, commissionPercent)
  );
}

export function getPreviousMonthPeriod(referenceDate: Date): MonthlyPeriod {
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  return { start, end, key };
}

export function getCommissionPeriod(referenceDate: Date): MonthlyPeriod {
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 20);
  const start = new Date(end.getFullYear(), end.getMonth() - 1, 20);
  const key = `${formatDateKey(start)}_${formatDateKey(previousDay(end))}`;
  return { start, end, key };
}

export function summarizeMonthlyReport(
  period: MonthlyPeriod,
  movements: MonthlyMovementWithRelations[],
  previousMovements: MonthlyMovementWithRelations[],
  commissionPercent: number,
  showStockLocations: boolean
): MonthlyReportFormatInput {
  const sales = movements.filter((movement) => movement.type === MovementType.SALE);
  const previousSales = previousMovements.filter(
    (movement) => movement.type === MovementType.SALE
  );
  const totalRevenue = sumSalesValue(sales);

  return {
    period,
    commissionPercent,
    paymentTotals: calculateMonthlyPaymentTotals(sales),
    totalRevenue,
    previousMonthRevenue: sumSalesValue(previousSales),
    saleCount: countSaleGroups(sales),
    unitsSold: sumSaleQuantity(sales),
    previousMonthUnitsSold: sumSaleQuantity(previousSales),
    movementCounts: countMovements(movements),
    sellers: summarizeSellers(sales, commissionPercent),
    bestSellers: summarizeProducts(sales).slice(0, 3),
    zeroStockProducts: summarizeZeroStock(movements, sales),
    showStockLocations,
  };
}

export function summarizeCommissionReport(
  period: MonthlyPeriod,
  movements: MonthlyMovementWithRelations[],
  commissionPercent: number
): CommissionReportFormatInput {
  const sales = movements.filter((movement) => movement.type === MovementType.SALE);
  return {
    period,
    commissionPercent,
    sellers: summarizeSellers(sales, commissionPercent),
  };
}

export function formatMonthlyReport(input: MonthlyReportFormatInput): string[] {
  return [formatFinancialSummary(input)];
}

export function formatCommissionReport(input: CommissionReportFormatInput): string {
  const lines = [
    '💵 *RELATÓRIO DE COMISSÕES*',
    `Período: ${formatDate(input.period.start)} a ${formatDate(previousDay(input.period.end))}`,
    '',
    '👥 *FUNCIONÁRIOS*',
    '',
  ];

  if (input.sellers.length === 0) {
    lines.push('Nenhum funcionário registrou vendas no período.');
    return lines.join('\n');
  }

  for (const [index, seller] of input.sellers.entries()) {
    lines.push(
      `${index + 1}. *${seller.name}*`,
      `Vendas: *${seller.saleCount}* | Pneus: *${seller.quantity}*`,
      `Total vendido: *${formatCurrency(seller.totalValue)}*`,
      `Comissão (${formatPercent(input.commissionPercent)}): *${formatCurrency(seller.commission)}*`,
      ''
    );
  }
  lines.push(
    `Comissão total: *${formatCurrency(input.sellers.reduce((sum, seller) => sum + seller.commission, 0))}*`,
    '',
    '_TireFlow • Fechamento automático de comissões_'
  );
  return lines.join('\n');
}

function formatFinancialSummary(input: MonthlyReportFormatInput): string {
  const ticketAverage = input.saleCount > 0 ? input.totalRevenue / input.saleCount : 0;
  return [
    `📊 *FATURAMENTO MENSAL — ${formatMonthLabel(input.period.start)}*`,
    `Período: ${formatDate(input.period.start)} a ${formatDate(previousDay(input.period.end))}`,
    '',
    '💰 *RESULTADO DO MÊS*',
    `Faturamento: *${formatCurrency(input.totalRevenue)}*`,
    `Vendas realizadas: *${input.saleCount}*`,
    `Pneus vendidos: *${input.unitsSold}*`,
    `Ticket médio: *${formatCurrency(ticketAverage)}*`,
    '',
    '💳 *FORMAS DE PAGAMENTO*',
    `Dinheiro: *${formatCurrency(input.paymentTotals.Dinheiro)}*`,
    `PIX: *${formatCurrency(input.paymentTotals.PIX)}*`,
    `Cartão: *${formatCurrency(input.paymentTotals.Cartão)}*`,
    `Nota: *${formatCurrency(input.paymentTotals.Nota)}*`,
    '',
    '📦 *MOVIMENTAÇÕES*',
    `Vendas: *${input.movementCounts.sale}* | Entradas: *${input.movementCounts.entry}*`,
    `Ajustes: *${input.movementCounts.adjustment}* | Preços: *${input.movementCounts.priceChange}*`,
    '',
    '📈 *COMPARAÇÃO COM O MÊS ANTERIOR*',
    formatRevenueComparison(input.totalRevenue, input.previousMonthRevenue),
    formatUnitsComparison(input.unitsSold, input.previousMonthUnitsSold),
    '',
    '_TireFlow • Faturamento mensal automático_',
  ].join('\n');
}

function calculateMonthlyPaymentTotals(sales: MonthlyMovementWithRelations[]): PaymentTotals {
  const totals: PaymentTotals = { Dinheiro: 0, PIX: 0, Cartão: 0, Nota: 0 };

  for (const sale of sales) {
    if (sale.paymentMethod === 'Misto') {
      for (const part of parseStoredPaymentBreakdown(sale.paymentDetails)) {
        totals[part.method] += part.amount;
      }
      continue;
    }

    const method = PAYMENT_METHODS.find((item) => item === sale.paymentMethod);
    if (method) {
      totals[method] += toNumber(sale.totalValue);
    }
  }

  return totals;
}

function countMovements(movements: MonthlyMovementWithRelations[]): MonthlyMovementCounts {
  const sales = movements.filter((movement) => movement.type === MovementType.SALE);
  return {
    sale: countSaleGroups(sales),
    entry: movements.filter((movement) => movement.type === MovementType.ENTRY).length,
    adjustment: movements.filter((movement) => movement.type === MovementType.ADJUSTMENT).length,
    priceChange: movements.filter((movement) => movement.type === MovementType.PRICE_CHANGE).length,
  };
}

function summarizeSellers(
  sales: MonthlyMovementWithRelations[],
  commissionPercent: number
): SellerSummary[] {
  const sellers = new Map<string, SellerSummary>();
  const saleGroupsBySeller = new Map<string, Set<string>>();

  for (const sale of sales) {
    const current = sellers.get(sale.userId) ?? {
      name: sale.user.name,
      saleCount: 0,
      quantity: 0,
      totalValue: 0,
      commissionBase: 0,
      commission: 0,
    };
    const sellerSaleGroups = saleGroupsBySeller.get(sale.userId) ?? new Set<string>();
    sellerSaleGroups.add(getSaleGroupKey(sale));
    saleGroupsBySeller.set(sale.userId, sellerSaleGroups);
    current.saleCount = sellerSaleGroups.size;
    current.quantity += sale.quantity ?? 0;
    current.totalValue += toNumber(sale.totalValue);
    if (!sale.isCityHallSale) {
      current.commissionBase += toNumber(sale.totalValue);
    }
    sellers.set(sale.userId, current);
  }

  return [...sellers.values()]
    .map((seller) => ({
      ...seller,
      commission: roundCurrency(seller.commissionBase * commissionPercent / 100),
    }))
    .sort((left, right) => right.totalValue - left.totalValue);
}

function countSaleGroups(sales: MonthlyMovementWithRelations[]): number {
  return new Set(sales.map(getSaleGroupKey)).size;
}

function getSaleGroupKey(sale: MonthlyMovementWithRelations): string {
  return sale.saleGroupCode || sale.code;
}

function summarizeProducts(sales: MonthlyMovementWithRelations[]): ProductSummary[] {
  const products = new Map<string, ProductSummary>();

  for (const sale of sales) {
    const current = products.get(sale.productId) ?? {
      reference: sale.product.reference,
      description: sale.product.description,
      quantity: 0,
      totalValue: 0,
    };
    current.quantity += sale.quantity ?? 0;
    current.totalValue += toNumber(sale.totalValue);
    products.set(sale.productId, current);
  }

  return [...products.values()].sort((left, right) => {
    if (right.quantity !== left.quantity) {
      return right.quantity - left.quantity;
    }
    return right.totalValue - left.totalValue;
  });
}

function summarizeZeroStock(
  movements: MonthlyMovementWithRelations[],
  sales: MonthlyMovementWithRelations[]
): ZeroStockSummary[] {
  const soldByProduct = new Map<string, number>();
  for (const sale of sales) {
    soldByProduct.set(
      sale.productId,
      (soldByProduct.get(sale.productId) ?? 0) + (sale.quantity ?? 0)
    );
  }

  const stockMovementsByProduct = new Map<string, MonthlyMovementWithRelations[]>();
  for (const movement of movements) {
    if (movement.previousStock === null || movement.newStock === null) {
      continue;
    }
    const productMovements = stockMovementsByProduct.get(movement.productId) ?? [];
    productMovements.push(movement);
    stockMovementsByProduct.set(movement.productId, productMovements);
  }

  const result: ZeroStockSummary[] = [];
  for (const productMovements of stockMovementsByProduct.values()) {
    const zeroEvents = productMovements.filter(
      (movement) => (movement.previousStock ?? 0) > 0 && movement.newStock === 0
    );
    const lastZeroEvent = zeroEvents.at(-1);
    if (!lastZeroEvent) {
      continue;
    }

    const laterMovements = productMovements.filter(
      (movement) => movement.createdAt.getTime() > lastZeroEvent.createdAt.getTime()
    );
    const replenishment = laterMovements.find((movement) => (movement.newStock ?? 0) > 0);
    const lastStockMovement = productMovements.at(-1)!;

    result.push({
      reference: lastZeroEvent.product.reference,
      description: lastZeroEvent.product.description,
      stockLocation: lastZeroEvent.product.stockLocation,
      soldQuantity: soldByProduct.get(lastZeroEvent.productId) ?? 0,
      zeroedAt: lastZeroEvent.createdAt,
      endedAtZero: lastStockMovement.newStock === 0,
      replenishedAt: replenishment?.createdAt,
    });
  }

  return result;
}

function sumSalesValue(sales: MonthlyMovementWithRelations[]): number {
  return sales.reduce((sum, sale) => sum + toNumber(sale.totalValue), 0);
}

function sumSaleQuantity(sales: MonthlyMovementWithRelations[]): number {
  return sales.reduce((sum, sale) => sum + (sale.quantity ?? 0), 0);
}

function formatRevenueComparison(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0
      ? 'Faturamento: *sem variação*'
      : 'Faturamento: *sem base no mês anterior*';
  }

  const percentage = ((current - previous) / previous) * 100;
  return `Faturamento: *${formatSignedPercentage(percentage)}*`;
}

function formatUnitsComparison(current: number, previous: number): string {
  const difference = current - previous;
  const sign = difference > 0 ? '+' : '';
  return `Pneus vendidos: *${sign}${difference} unidades*`;
}

function formatSignedPercentage(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')}%`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace(/\.00$/, '').replace('.', ',')}%`;
}

function formatMonthLabel(date: Date): string {
  const month = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
  }).format(date).toUpperCase();
  return `${month}/${date.getFullYear()}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function previousDay(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - 1);
  return result;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
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
