import { MovementType } from '@prisma/client';
import type { Movement, Product, User } from '@prisma/client';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';

type MovementWithRelations = Movement & {
  product: Product;
  user: User;
};

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
    return [
      '✅ Estoque baixo',
      '',
      'Nenhum produto abaixo do estoque mínimo.',
    ].join('\n');
  }

  return [
    '⚠️ Estoque baixo',
    '',
    ...lowStockProducts.map((product, index) =>
      [
        `${index + 1}. ${product.reference} - ${product.description}`,
        `Estoque: ${product.stock}`,
        `Mínimo: ${product.minStock}`,
        `À vista: ${formatCurrency(toNumber(product.cashPrice))}`,
        `A prazo: ${formatCurrency(toNumber(product.creditPrice))}`,
      ].join('\n')
    ),
    '',
    'Para repor estoque:\nentrada 1',
    'Para ajustar estoque:\najuste 1',
    'Para alterar preço:\npreco 1',
  ].join('\n\n');
}

export async function buildBestSellersReport(limit = 10): Promise<string> {
  const sales = await movementRepository.findByType(MovementType.SALE);
  const bestSellers = summarizeSalesByProduct(sales).slice(0, limit);

  if (bestSellers.length === 0) {
    return [
      '🏆 Mais vendidos',
      '',
      'Nenhuma venda registrada ainda.',
    ].join('\n');
  }

  return [
    '🏆 Mais vendidos',
    '',
    ...bestSellers.map((item, index) =>
      [
        `${index + 1}. ${item.product.reference} - ${item.product.description}`,
        `Quantidade vendida: ${item.quantity}`,
        `Faturamento: ${formatCurrency(item.totalValue)}`,
      ].join('\n')
    ),
  ].join('\n\n');
}

export async function buildTodayReport(referenceDate = new Date()): Promise<string> {
  const range = getDayRange(referenceDate);
  const movements = await movementRepository.findByDateRange(range.start, range.end);
  const sales = movements.filter((movement) => movement.type === MovementType.SALE);
  const paymentTotals = getPaymentTotals(sales);
  const totalRevenue = PAYMENT_METHODS.reduce((sum, method) => sum + paymentTotals[method], 0);
  const bestSeller = summarizeSalesByProduct(sales)[0];
  const movementCounts = getMovementCounts(movements);

  const lines = [
    '📊 Relatório de hoje',
    '',
    `Data: ${formatDate(referenceDate)}`,
    '',
  ];

  if (movements.length === 0) {
    lines.push('Não houve movimentações hoje.', '');
  }

  lines.push(
    'Vendas por pagamento:',
    `Dinheiro: ${formatCurrency(paymentTotals.Dinheiro)}`,
    `PIX: ${formatCurrency(paymentTotals.PIX)}`,
    `Cartão: ${formatCurrency(paymentTotals.Cartão)}`,
    `Nota: ${formatCurrency(paymentTotals.Nota)}`,
    '',
    `Faturamento total do dia: ${formatCurrency(totalRevenue)}`,
    '',
    'Movimentações:',
    `Vendas: ${movementCounts.sale}`,
    `Entradas: ${movementCounts.entry}`,
    `Ajustes: ${movementCounts.adjustment}`,
    `Alterações de preço: ${movementCounts.priceChange}`,
    '',
    `Produto mais vendido do dia: ${formatBestSeller(bestSeller)}`,
    '',
    'TireFlow - Relatório automático'
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

function getPaymentTotals(sales: MovementWithRelations[]): Record<(typeof PAYMENT_METHODS)[number], number> {
  const totals = {
    Dinheiro: 0,
    PIX: 0,
    Cartão: 0,
    Nota: 0,
  };

  for (const sale of sales) {
    const method = PAYMENT_METHODS.find((paymentMethod) => paymentMethod === sale.paymentMethod);

    if (method) {
      totals[method] += toNumber(sale.totalValue);
    }
  }

  return totals;
}

function getMovementCounts(movements: MovementWithRelations[]) {
  return {
    sale: movements.filter((movement) => movement.type === MovementType.SALE).length,
    entry: movements.filter((movement) => movement.type === MovementType.ENTRY).length,
    adjustment: movements.filter((movement) => movement.type === MovementType.ADJUSTMENT).length,
    priceChange: movements.filter((movement) => movement.type === MovementType.PRICE_CHANGE).length,
  };
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

function formatBestSeller(bestSeller: ProductSalesSummary | undefined): string {
  if (!bestSeller || bestSeller.quantity <= 0) {
    return 'Nenhum produto vendido hoje.';
  }

  return `${bestSeller.product.reference} - ${bestSeller.product.description} (${bestSeller.quantity} un.)`;
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
