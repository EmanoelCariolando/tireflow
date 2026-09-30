import { MovementType, ProductCategory as Category } from '@prisma/client';
import type { Movement, Product, ProductCategory, User } from '@prisma/client';
import env from '../config/env.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { pendingSaleReportRepository, type ReportPendingSale } from '../repositories/pendingSaleReportRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { parseStoredPaymentBreakdown } from '../utils/salePayment.js';
import {
  DISCOUNTED_COMMISSION_PERCENT,
  STANDARD_COMMISSION_PERCENT,
} from '../utils/commissionRates.js';
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
  standardCommissionBase: number;
  discountedCommissionBase: number;
  cityHallSalesValue: number;
  standardCommission: number;
  discountedCommission: number;
  commission: number;
}

interface ProductSummary {
  reference: string;
  description: string;
  quantity: number;
  totalValue: number;
  category?: ProductCategory;
}

interface ZeroStockSummary {
  reference: string;
  description: string;
  stockLocation: string | null;
  soldQuantity: number;
  zeroedAt: Date;
  endedAtZero: boolean;
  replenishedAt?: Date;
  category?: ProductCategory;
}

export interface MonthlyPeriod {
  start: Date;
  end: Date;
  key: string;
}

export interface MonthlyReportFormatInput {
  dailyHistory?: Array<{ date: Date; entries: string[] }>;
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

export interface InventoryReportPdfDelivery {
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
  const builtReport = await buildInventoryReportForPeriod(
    period,
    previousPeriod,
    referenceDate,
    commissionPercent,
    getMonthlyInventoryPdfFileName(period.key)
  );

  return {
    financialMessage: formatMonthlyReport(builtReport.report)[0]!,
    pdfBuffer: builtReport.pdfBuffer,
    pdfFileName: builtReport.pdfFileName,
  };
}

export async function buildInventoryReportPdf(
  period: MonthlyPeriod,
  generatedAt = new Date(),
  commissionPercent = env.monthlyCommissionPercent
): Promise<InventoryReportPdfDelivery> {
  const previousPeriod = getPreviousComparablePeriod(period);
  const lastDay = previousDay(period.end);
  const fileName = [
    'relatorio-mensal',
    formatDateKey(period.start),
    'a',
    `${formatDateKey(lastDay)}.pdf`,
  ].join('-');
  const builtReport = await buildInventoryReportForPeriod(
    period,
    previousPeriod,
    generatedAt,
    commissionPercent,
    fileName
  );

  return {
    pdfBuffer: builtReport.pdfBuffer,
    pdfFileName: builtReport.pdfFileName,
  };
}

async function buildInventoryReportForPeriod(
  period: MonthlyPeriod,
  previousPeriod: MonthlyPeriod,
  generatedAt: Date,
  commissionPercent: number,
  pdfFileName: string
): Promise<{ report: MonthlyReportFormatInput; pdfBuffer: Buffer; pdfFileName: string }> {
  const [movements, previousMovements, pendingSales] = await Promise.all([
    movementRepository.findByDateRange(period.start, period.end),
    movementRepository.findByDateRange(previousPeriod.start, previousPeriod.end),
    pendingSaleReportRepository.findByDateRange(period.start, period.end),
  ]);
  const report = summarizeMonthlyReport(
    period,
    movements,
    previousMovements,
    commissionPercent,
    env.inventoryLocationsEnabled,
    pendingSales
  );
  report.dailyHistory = buildDailyMovementHistory(period, movements, pendingSales);

  return {
    pdfBuffer: await buildMonthlyInventoryPdf({
      report,
      products: [],
      branchName: env.branchName,
      generatedAt,
    }),
    pdfFileName,
    report,
  };
}

export async function buildCurrentStockReportPdf(generatedAt = new Date()): Promise<InventoryReportPdfDelivery> {
  const products = (await productRepository.findActiveWithPositiveStock())
    .filter((product) => product.category === Category.TIRE);
  return {
    pdfFileName: `pneus-estoque-atual-${formatDateKey(generatedAt)}.pdf`,
    pdfBuffer: await buildMonthlyInventoryPdf({
      mode: 'stock',
      products,
      branchName: env.branchName,
      generatedAt,
      report: {
        period: { start: generatedAt, end: generatedAt, key: formatDateKey(generatedAt) },
        bestSellers: [],
        zeroStockProducts: [],
        showStockLocations: env.inventoryLocationsEnabled,
      },
    }),
  };
}

export async function buildCommissionReport(
  referenceDate = new Date(),
  commissionPercent = env.monthlyCommissionPercent
): Promise<string> {
  const period = getCommissionPeriod(referenceDate);
  return buildCommissionReportForPeriod(period, commissionPercent);
}

export async function buildCommissionReportForPeriod(
  period: MonthlyPeriod,
  commissionPercent = env.monthlyCommissionPercent
): Promise<string> {
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

function getPreviousComparablePeriod(period: MonthlyPeriod): MonthlyPeriod {
  const dayCount = countCalendarDays(period.start, period.end);
  const end = new Date(period.start);
  const start = new Date(end);
  start.setDate(start.getDate() - dayCount);
  return {
    start,
    end,
    key: `${formatDateKey(start)}_${formatDateKey(previousDay(end))}`,
  };
}

export function getCommissionPeriod(referenceDate: Date): MonthlyPeriod {
  return getPreviousMonthPeriod(referenceDate);
}

export function summarizeMonthlyReport(
  period: MonthlyPeriod,
  movements: MonthlyMovementWithRelations[],
  previousMovements: MonthlyMovementWithRelations[],
  commissionPercent: number,
  showStockLocations: boolean,
  pendingSales: ReportPendingSale[] = []
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
    zeroStockProducts: summarizeZeroStock(buildStockHistory(period, movements, pendingSales), sales),
    showStockLocations,
  };
}

export function buildDailyMovementHistory(
  period: MonthlyPeriod,
  movements: MonthlyMovementWithRelations[],
  pendingSales: ReportPendingSale[] = []
): NonNullable<MonthlyReportFormatInput['dailyHistory']> {
  const days = new Map<string, { date: Date; entries: string[] }>();
  for (const date = new Date(period.start); date < period.end; date.setDate(date.getDate() + 1)) {
    days.set(formatDateKey(date), { date: new Date(date), entries: [] });
  }
  const events: Array<{ date: Date; text: string }> = [];
  const completedSales = new Map(pendingSales.filter((pending) => pending.completedSaleGroupCode)
    .map((pending) => [pending.completedSaleGroupCode!, pending]));
  for (const pending of pendingSales) {
    for (const item of pending.items) {
      events.push({ date: pending.createdAt, text:
        `${pending.createdBy.name} abriu a pendência para ${pending.assignedTo.name}: ${item.quantity} un. de ${item.reference} ${item.description}. Estoque disponível: ${item.previousStock} para ${item.reservedStock} un.${item.previousStock > 0 && item.reservedStock === 0 ? ' ESTOQUE ZERADO pela reserva.' : ''}`,
      });
    }
  }
  for (const movement of movements) {
    const pending = movement.saleGroupCode ? completedSales.get(movement.saleGroupCode) : undefined;
    const product = `${movement.product.reference} ${movement.product.description}`;
    const quantity = movement.quantity === null ? 'quantidade não registrada' : `${movement.quantity} un.`;
    let action: string;
    switch (movement.type) {
      case MovementType.SALE:
        action = `vendeu ${quantity} de ${product}`;
        if (pending) action += ` e fechou a pendência, aberta em ${formatDate(pending.createdAt)} para ${pending.assignedTo.name} (estoque já reservado na abertura)`;
        if (movement.totalValue !== null) action += `. Total: ${formatCurrency(toNumber(movement.totalValue))}`;
        if (movement.paymentMethod) action += `. Pagamento: ${movement.paymentMethod}`;
        break;
      case MovementType.ENTRY:
        action = `deu entrada em ${quantity} de ${product}`;
        if (movement.supplier) action += `. Fornecedor: ${movement.supplier}`;
        if (movement.invoiceNumber) action += `. Nota: ${movement.invoiceNumber}`;
        break;
      case MovementType.ADJUSTMENT:
        action = `ajustou o estoque de ${product}: ${movement.previousStock ?? '?'} para ${movement.newStock ?? '?'} un.`;
        if (movement.observation?.startsWith('Retorno da pendência ')) {
          action = `devolveu ${quantity} de ${product} ao estoque e fechou a pendência sem venda`;
        } else if (movement.observation) {
          action += ` ${movement.observation}`;
        }
        if (movement.reason) action += `. Motivo: ${movement.reason}`;
        break;
      case MovementType.PRICE_CHANGE:
        action = `alterou os preços de ${product}`;
        try {
          const prices = JSON.parse(movement.observation ?? 'null');
          if (prices && ['oldCashPrice', 'newCashPrice', 'oldCreditPrice', 'newCreditPrice']
            .every((key) => typeof prices[key] === 'number' && Number.isFinite(prices[key]))) {
            action += `: à vista ${formatCurrency(prices.oldCashPrice)} para ${formatCurrency(prices.newCashPrice)}; a prazo ${formatCurrency(prices.oldCreditPrice)} para ${formatCurrency(prices.newCreditPrice)}`;
          } else {
            action += ' (detalhes anteriores não disponíveis)';
          }
        } catch {
          action += ' (detalhes anteriores não disponíveis)';
        }
        break;
    }
    if (!pending && movement.type !== MovementType.PRICE_CHANGE && movement.previousStock !== null && movement.newStock !== null) {
      action += `. Estoque: ${movement.previousStock} para ${movement.newStock} un.`;
      if (movement.previousStock > 0 && movement.newStock === 0) action += ' ESTOQUE ZERADO.';
      if (movement.previousStock === 0 && movement.newStock > 0) action += ' ESTOQUE REPOSTO.';
    }
    events.push({ date: movement.createdAt, text: `${movement.user.name} ${action}` });
  }
  events.sort((left, right) => left.date.getTime() - right.date.getTime());
  for (const event of events) {
    if (event.date < period.start || event.date >= period.end) continue;
    const time = `${String(event.date.getHours()).padStart(2, '0')}:${String(event.date.getMinutes()).padStart(2, '0')}`;
    days.get(formatDateKey(event.date))?.entries.push(`${time} - ${event.text}`.replace(/\s+/g, ' ').trim());
  }
  return [...days.values()];
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
      `Vendas: *${seller.saleCount}* | Itens: *${seller.quantity}* | Total: *${formatCurrency(seller.totalValue)}*`,
      `✅ Comissão ${STANDARD_COMMISSION_PERCENT}%: *${formatCurrency(seller.standardCommission)}* (base ${formatCurrency(seller.standardCommissionBase)}) | 🏷️ Comissão ${DISCOUNTED_COMMISSION_PERCENT}%: *${formatCurrency(seller.discountedCommission)}* (base ${formatCurrency(seller.discountedCommissionBase)})`,
      `🏛️ Prefeitura 0%: *${formatCurrency(seller.cityHallSalesValue)}*`,
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
    `Itens vendidos: *${input.unitsSold}*`,
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
      standardCommissionBase: 0,
      discountedCommissionBase: 0,
      cityHallSalesValue: 0,
      standardCommission: 0,
      discountedCommission: 0,
      commission: 0,
    };
    const sellerSaleGroups = saleGroupsBySeller.get(sale.userId) ?? new Set<string>();
    sellerSaleGroups.add(getSaleGroupKey(sale));
    saleGroupsBySeller.set(sale.userId, sellerSaleGroups);
    current.saleCount = sellerSaleGroups.size;
    current.quantity += sale.quantity ?? 0;
    current.totalValue += toNumber(sale.totalValue);
    const saleValue = toNumber(sale.totalValue);
    const saleCommissionPercent = sale.commissionPercent === null
      ? commissionPercent
      : toNumber(sale.commissionPercent);
    if (sale.isCityHallSale || saleCommissionPercent === 0) {
      current.cityHallSalesValue += toNumber(sale.totalValue);
    } else if (saleCommissionPercent === DISCOUNTED_COMMISSION_PERCENT) {
      current.commissionBase += saleValue;
      current.discountedCommissionBase += saleValue;
    } else {
      current.commissionBase += saleValue;
      current.standardCommissionBase += saleValue;
    }
    sellers.set(sale.userId, current);
  }

  return [...sellers.values()]
    .map((seller) => ({
      ...seller,
      standardCommission: roundCurrency(
        seller.standardCommissionBase * STANDARD_COMMISSION_PERCENT / 100
      ),
      discountedCommission: roundCurrency(
        seller.discountedCommissionBase * DISCOUNTED_COMMISSION_PERCENT / 100
      ),
      commission: roundCurrency(
        seller.standardCommissionBase * STANDARD_COMMISSION_PERCENT / 100 +
        seller.discountedCommissionBase * DISCOUNTED_COMMISSION_PERCENT / 100
      ),
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

type StockHistoryEvent = Pick<MonthlyMovementWithRelations, 'productId' | 'previousStock' | 'newStock' | 'createdAt'> & {
  product: Pick<Product, 'reference' | 'description' | 'stockLocation' | 'category'>;
};

function buildStockHistory(
  period: MonthlyPeriod,
  movements: MonthlyMovementWithRelations[],
  pendingSales: ReportPendingSale[]
): StockHistoryEvent[] {
  const completedCodes = new Set(pendingSales.map((pending) => pending.completedSaleGroupCode).filter(Boolean));
  const events: StockHistoryEvent[] = movements.filter((movement) =>
    !movement.saleGroupCode || !completedCodes.has(movement.saleGroupCode)
  );
  for (const pending of pendingSales) {
    if (pending.createdAt < period.start || pending.createdAt >= period.end) continue;
    for (const item of pending.items) {
      events.push({
        productId: item.productId, previousStock: item.previousStock, newStock: item.reservedStock,
        createdAt: pending.createdAt,
        product: { ...item.product, reference: item.reference, description: item.description },
      });
    }
  }
  return events.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function summarizeZeroStock(
  movements: StockHistoryEvent[],
  sales: MonthlyMovementWithRelations[]
): ZeroStockSummary[] {
  const soldByProduct = new Map<string, number>();
  for (const sale of sales) {
    soldByProduct.set(
      sale.productId,
      (soldByProduct.get(sale.productId) ?? 0) + (sale.quantity ?? 0)
    );
  }

  const stockMovementsByProduct = new Map<string, StockHistoryEvent[]>();
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
      category: lastZeroEvent.product.category,
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
  return `Itens vendidos: *${sign}${difference} unidades*`;
}

function formatSignedPercentage(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')}%`;
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

function countCalendarDays(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
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
