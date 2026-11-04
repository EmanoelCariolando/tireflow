import { createHash } from 'node:crypto';
import { MovementType, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';
import { getCommissionPercentForCategory } from '../utils/commissionRates.js';
import { allocateAmountByWeights } from '../utils/saleAllocation.js';
import { parseStoredPaymentBreakdown } from '../utils/salePayment.js';
import { getFinancialMonth, getFinancialPeriod } from '../utils/financialPeriod.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { isValidStockQuantity } from '../utils/stockQuantity.js';

type Tx = Prisma.TransactionClient;

export class FinancialOperationError extends Error {}

export async function assertFinancialAdministrator(phone: string, tx: Tx = prisma) {
  const user = await tx.user.findUnique({ where: { phone } });
  if (!user?.isActive || user.role !== 'ADMIN') {
    throw new FinancialOperationError('Operação restrita a administradores ativos.');
  }
  return user;
}

function cents(value: Prisma.Decimal | number): number {
  const result = new Prisma.Decimal(value).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(result)) throw new FinancialOperationError('Valor financeiro fora do limite permitido.');
  return result;
}

function money(value: number): Prisma.Decimal {
  if (!Number.isSafeInteger(value)) throw new FinancialOperationError('Valor financeiro fora do limite permitido.');
  return new Prisma.Decimal(value).div(100);
}

function proportional(total: number, quantity: number, originalQuantity: number): number {
  return new Prisma.Decimal(total).mul(quantity).div(originalQuantity)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface ReversalSelection {
  position: number;
  quantity: number;
  returnedQuantity: number;
}

export interface ReversalRequest {
  actorPhone: string;
  operationId: string;
  saleCode: string;
  reason: string;
  selections: ReversalSelection[] | 'all';
  expectedAmounts?: number[];
}

async function reversalPlan(tx: Tx, request: ReversalRequest) {
  const first = await tx.movement.findUnique({ where: { code: request.saleCode } });
  if (!first || first.type !== MovementType.SALE) throw new FinancialOperationError('Venda não encontrada.');
  const saleGroupCode = first.saleGroupCode ?? first.code;
  const sales = await tx.movement.findMany({
    where: first.saleGroupCode ? { type: MovementType.SALE, saleGroupCode } : { id: first.id },
    include: { product: true, reversalItems: true }, orderBy: { code: 'asc' },
  });
  const selections = request.selections === 'all'
    ? sales.map((sale, index) => ({ position: index + 1,
      quantity: (sale.quantity ?? 0) - sale.reversalItems.reduce((sum, item) => sum + item.quantity, 0), returnedQuantity: 0 }))
      .filter(item => item.quantity > 0)
    : [...request.selections].sort((a, b) => a.position - b.position);
  if (!selections.length || new Set(selections.map(item => item.position)).size !== selections.length) {
    throw new FinancialOperationError('Informe itens distintos com quantidade disponível para estorno.');
  }
  const items = selections.map(selection => {
    const sale = sales[selection.position - 1];
    if (!sale || !sale.quantity || sale.totalValue === null ||
      !isValidStockQuantity(selection.quantity) || selection.quantity <= 0 ||
      !isValidStockQuantity(selection.returnedQuantity) || selection.returnedQuantity > selection.quantity) {
      throw new FinancialOperationError('Item ou quantidade de estorno/devolução inválida.');
    }
    const previousQuantity = sale.reversalItems.reduce((sum, item) => sum + item.quantity, 0);
    if (previousQuantity + selection.quantity > sale.quantity) {
      throw new FinancialOperationError('A quantidade ultrapassa o saldo ainda não estornado.');
    }
    const originalAmount = cents(sale.totalValue);
    const previousAmount = sale.reversalItems.reduce((sum, item) => sum + cents(item.amount), 0);
    const cumulativeAmount = proportional(originalAmount, previousQuantity + selection.quantity, sale.quantity);
    const amount = cumulativeAmount - previousAmount;
    if (amount < 0 || cumulativeAmount > originalAmount) throw new FinancialOperationError('Saldo financeiro inconsistente.');
    const payments = sale.paymentMethod === 'Misto' ? parseStoredPaymentBreakdown(sale.paymentDetails)
      : [{ method: sale.paymentMethod ?? '', amount: Number(sale.totalValue) }];
    if (payments.length === 0 || payments.some(part => !['Dinheiro', 'PIX', 'Cartão', 'Nota'].includes(part.method)) ||
      payments.reduce((sum, part) => sum + cents(part.amount), 0) !== originalAmount) {
      throw new FinancialOperationError('A venda não possui detalhamento de pagamento válido para estorno.');
    }
    const weights = payments.map(part => cents(part.amount) - sale.reversalItems.reduce((sum, item) => {
      const previous = JSON.parse(item.paymentDetails) as Array<{ method: string; amount: number }>;
      return sum + previous.filter(value => value.method === part.method).reduce((subtotal, value) => subtotal + cents(value.amount), 0);
    }, 0));
    if (weights.some(value => value < 0) || weights.reduce((sum, value) => sum + value, 0) !== originalAmount - previousAmount) {
      throw new FinancialOperationError('Saldo dos pagamentos inconsistente.');
    }
    const allocations = allocateAmountByWeights(amount, weights);
    const paymentDetails = payments.map((part, index) => ({ method: part.method, amount: allocations[index] / 100 }));
    return { selection, sale, amount, paymentDetails };
  });
  return { saleGroupCode, items };
}

export async function previewSaleReversal(request: ReversalRequest) {
  await assertFinancialAdministrator(request.actorPhone);
  const plan = await reversalPlan(prisma, request);
  return { saleGroupCode: plan.saleGroupCode, amount: plan.items.reduce((sum, item) => sum + item.amount, 0) / 100,
    selections: plan.items.map(item => item.selection), expectedAmounts: plan.items.map(item => item.amount),
    lines: plan.items.map(item => `${item.selection.position}. ${item.sale.product.reference} — ${item.sale.product.description}: ` +
      `${item.selection.quantity} un.; recebidas ${item.selection.returnedQuantity}; ${formatCurrency(item.amount / 100)}`) };
}

export async function registerSaleReversal(request: ReversalRequest) {
  const reason = request.reason.trim();
  if (!request.operationId || !reason || reason.length > 500) throw new FinancialOperationError('Informe o motivo do estorno (até 500 caracteres).');
  const requestHash = fingerprint({ actorPhone: request.actorPhone, saleCode: request.saleCode,
    reason, selections: request.selections, expectedAmounts: request.expectedAmounts });
  return withInventoryMutationLock(() => prisma.$transaction(async tx => {
    const admin = await assertFinancialAdministrator(request.actorPhone, tx);
    const existing = await tx.saleReversal.findUnique({ where: { operationId: request.operationId } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new FinancialOperationError('Essa operação já foi registrada com outros dados.');
      return existing;
    }
    const plan = await reversalPlan(tx, request);
    if (request.expectedAmounts && fingerprint(request.expectedAmounts) !== fingerprint(plan.items.map(item => item.amount))) {
      throw new FinancialOperationError('O saldo mudou desde a consulta. Revise o estorno novamente.');
    }
    const now = new Date();
    const reversal = await tx.saleReversal.create({ data: {
      code: `#E-${String(await tx.saleReversal.count() + 1).padStart(6, '0')}`,
      operationId: request.operationId, requestHash, requestJson: JSON.stringify({ ...request, reason }),
      saleGroupCode: plan.saleGroupCode, authorizedById: admin.id, reason,
      amount: money(plan.items.reduce((sum, item) => sum + item.amount, 0)), createdAt: now,
    } });
    for (const [index, item] of plan.items.entries()) {
      const registered = await tx.saleReversalItem.create({ data: {
        reversalId: reversal.id, position: item.selection.position, movementId: item.sale.id,
        quantity: item.selection.quantity, amount: money(item.amount), paymentDetails: JSON.stringify(item.paymentDetails),
      } });
      await tx.commissionAdjustment.create({ data: { reversalItemId: registered.id,
        sellerId: item.sale.userId, createdAt: now } });
      if (item.selection.returnedQuantity > 0) {
        await receiveReturn(tx, { operationId: `${request.operationId}:return:${index}`, actorPhone: request.actorPhone,
          reversalCode: reversal.code, position: item.selection.position, quantity: item.selection.returnedQuantity });
      }
    }
    return reversal;
  }));
}

export interface ReturnRequest {
  operationId: string;
  actorPhone: string;
  reversalCode: string;
  position: number;
  quantity: number;
}

async function receiveReturn(tx: Tx, request: ReturnRequest) {
  const admin = await assertFinancialAdministrator(request.actorPhone, tx);
  if (!request.operationId || !Number.isSafeInteger(request.position) || request.position <= 0 ||
    !isValidStockQuantity(request.quantity) || request.quantity <= 0) throw new FinancialOperationError('Quantidade de devolução inválida.');
  const requestHash = fingerprint({ actorPhone: request.actorPhone, reversalCode: request.reversalCode,
    position: request.position, quantity: request.quantity });
  const existing = await tx.saleReversalReturn.findUnique({ where: { operationId: request.operationId } });
  if (existing) {
    if (existing.requestHash !== requestHash) throw new FinancialOperationError('Essa devolução já foi registrada com outros dados.');
    return existing;
  }
  const reversal = await tx.saleReversal.findUnique({ where: { code: request.reversalCode } });
  const item = reversal ? await tx.saleReversalItem.findUnique({
    where: { reversalId_position: { reversalId: reversal.id, position: request.position } },
    include: { returns: true, movement: { include: { product: true } } },
  }) : null;
  if (!item || item.returns.reduce((sum, returned) => sum + returned.quantity, 0) + request.quantity > item.quantity) {
    throw new FinancialOperationError('A devolução ultrapassa o saldo físico do estorno.');
  }
  const product = item.movement.product;
  if (!isValidStockQuantity(product.stock + request.quantity)) throw new FinancialOperationError('Saldo de estoque fora do limite permitido.');
  const updated = await tx.product.update({ where: { id: product.id }, data: { stock: { increment: request.quantity } } });
  const movement = await tx.movement.create({ data: {
    code: generateMovementCode('A', await tx.movement.count({ where: { type: MovementType.ADJUSTMENT } }) + 1),
    type: MovementType.ADJUSTMENT, productId: product.id, userId: admin.id, quantity: request.quantity,
    previousStock: product.stock, newStock: updated.stock,
    reason: `Devolução física do estorno ${request.reversalCode}`, observation: item.movement.code,
  } });
  return tx.saleReversalReturn.create({ data: { operationId: request.operationId, requestHash,
    reversalItemId: item.id, quantity: request.quantity, authorizedById: admin.id, movementId: movement.id, createdAt: new Date() } });
}

export async function registerReversalReturn(request: ReturnRequest) {
  return withInventoryMutationLock(() => prisma.$transaction(tx => receiveReturn(tx, request)));
}

export async function readSaleReversal(actorPhone: string, code: string) {
  await assertFinancialAdministrator(actorPhone);
  const reversal = await prisma.saleReversal.findUnique({ where: { code }, include: {
    items: { include: { returns: true, movement: { include: { product: true } } }, orderBy: { position: 'asc' } },
  } });
  if (!reversal) throw new FinancialOperationError('Estorno não encontrado.');
  return reversal;
}

export interface ClosingSnapshot {
  period: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  lines: Array<{ movementId: string; sellerId: string; amount: number; commission: number }>;
  sellers: Array<{ sellerId: string; name: string; earned: number; adjustments: number; net: number }>;
  adjustments: Array<{ id: string; amount: number }>;
}

async function closingSnapshot(tx: Tx, periodKey: string): Promise<ClosingSnapshot> {
  const period = getFinancialPeriod(periodKey);
  if (period.end > new Date()) throw new FinancialOperationError('O mês ainda está em andamento.');
  const sales = await tx.movement.findMany({ where: { type: MovementType.SALE,
    createdAt: { gte: period.start, lt: period.end } }, include: { user: true, product: true }, orderBy: { code: 'asc' } });
  const lines: ClosingSnapshot['lines'] = [];
  const groups = new Map<string, typeof sales>();
  for (const sale of sales) {
    if (sale.totalValue === null) throw new FinancialOperationError('Venda sem valor financeiro registrado.');
    const rate = sale.isCityHallSale ? 0 : getCommissionPercentForCategory(sale.product.category,
      sale.commissionPercent === null ? undefined : Number(sale.commissionPercent));
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new FinancialOperationError('Taxa de comissão histórica inválida.');
    const key = sale.userId;
    groups.set(key, [...(groups.get(key) ?? []), sale]);
  }
  const sellers = new Map<string, ClosingSnapshot['sellers'][number]>();
  for (const grouped of groups.values()) {
    const amounts = grouped.map(sale => cents(sale.totalValue!));
    const exact = grouped.map((sale, index) => new Prisma.Decimal(amounts[index]).mul(sale.isCityHallSale ? 0 :
      getCommissionPercentForCategory(sale.product.category, sale.commissionPercent === null ? undefined : Number(sale.commissionPercent))).div(100));
    const commission = exact.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0))
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
    const allocations = exact.map(value => value.floor().toNumber());
    const remainderOrder = exact.map((value, index) => ({ index, remainder: value.sub(allocations[index]) }))
      .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
    const remainder = commission - allocations.reduce((sum, value) => sum + value, 0);
    for (const item of remainderOrder.slice(0, remainder)) allocations[item.index]++;
    for (const [index, sale] of grouped.entries()) {
      lines.push({ movementId: sale.id, sellerId: sale.userId, amount: amounts[index], commission: allocations[index] });
      const seller = sellers.get(sale.userId) ?? { sellerId: sale.userId, name: sale.user.name, earned: 0, adjustments: 0, net: 0 };
      seller.earned += allocations[index]; sellers.set(sale.userId, seller);
    }
  }
  const pending = await tx.commissionAdjustment.findMany({ where: { closingId: null },
    include: { seller: true, reversalItem: { include: { movement: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const adjustments: ClosingSnapshot['adjustments'] = [];
  for (const adjustment of pending) {
    const original = adjustment.reversalItem.movement;
    const originalPeriod = getFinancialMonth(original.createdAt);
    if (originalPeriod > periodKey) continue;
    let basis = lines.find(line => line.movementId === original.id);
    if (originalPeriod !== periodKey) {
      const prior = await tx.financialClosing.findUnique({ where: { period: originalPeriod } });
      if (!prior) throw new FinancialOperationError(`Feche primeiro o mês de origem ${originalPeriod} para apurar a comissão do estorno.`);
      basis = (JSON.parse(prior.snapshotJson) as ClosingSnapshot).lines.find(line => line.movementId === original.id);
    }
    if (!basis || basis.amount < 0) throw new FinancialOperationError('Base histórica da comissão não encontrada.');
    const allItems = await tx.saleReversalItem.findMany({ where: { movementId: original.id },
      include: { reversal: true }, orderBy: [{ reversal: { createdAt: 'asc' } }, { reversal: { code: 'asc' } }] });
    let previousRefund = 0;
    let amount = 0;
    for (const item of allItems) {
      const refunded = previousRefund + cents(item.amount);
      if (item.id === adjustment.reversalItemId) {
        amount = basis.amount === 0 ? 0 : -(proportional(basis.commission, refunded, basis.amount) - proportional(basis.commission, previousRefund, basis.amount));
        break;
      }
      previousRefund = refunded;
    }
    const seller = sellers.get(adjustment.sellerId) ?? {
      sellerId: adjustment.sellerId, name: adjustment.seller.name, earned: 0, adjustments: 0, net: 0,
    };
    seller.adjustments += amount; sellers.set(seller.sellerId, seller);
    adjustments.push({ id: adjustment.id, amount });
  }
  const refunds = await tx.saleReversal.findMany({ where: { createdAt: { gte: period.start, lt: period.end } } });
  const grossRevenue = sales.reduce((sum, sale) => sum + cents(sale.totalValue!), 0);
  const refundedRevenue = refunds.reduce((sum, refund) => sum + cents(refund.amount), 0);
  for (const seller of sellers.values()) seller.net = seller.earned + seller.adjustments;
  money(grossRevenue); money(refundedRevenue);
  return { period: periodKey, grossRevenue, refunds: refundedRevenue, netRevenue: grossRevenue - refundedRevenue,
    lines, sellers: [...sellers.values()].sort((a, b) => a.sellerId.localeCompare(b.sellerId)), adjustments };
}

export function formatFinancialClosing(snapshot: ClosingSnapshot): string {
  return [`📒 *FECHAMENTO ${snapshot.period}*`, `Vendas: ${formatCurrency(snapshot.grossRevenue / 100)}`,
    `Estornos lançados no mês: ${formatCurrency(snapshot.refunds / 100)}`, `Faturamento líquido: ${formatCurrency(snapshot.netRevenue / 100)}`].join('\n');
}

export function formatClosingCommissions(snapshot: ClosingSnapshot): string {
  return [`💵 *COMISSÕES — FECHAMENTO ${snapshot.period}*`, ...snapshot.sellers.map((seller, index) =>
    `${index + 1}. ${seller.name}\nComissão: ${formatCurrency(seller.earned / 100)} | Ajustes de estorno: ${formatCurrency(seller.adjustments / 100)}\nSaldo: ${formatCurrency(seller.net / 100)}`)].join('\n\n');
}

export async function previewFinancialClosing(actorPhone: string, period: string) {
  await assertFinancialAdministrator(actorPhone);
  const existing = await prisma.financialClosing.findUnique({ where: { period } });
  const snapshot = existing ? JSON.parse(existing.snapshotJson) as ClosingSnapshot : await closingSnapshot(prisma, period);
  return { snapshot, hash: fingerprint(snapshot) };
}

export async function closeFinancialMonth(actorPhone: string, period: string, expectedHash: string) {
  return withInventoryMutationLock(() => prisma.$transaction(async tx => {
    const admin = await assertFinancialAdministrator(actorPhone, tx);
    const existing = await tx.financialClosing.findUnique({ where: { period } });
    if (existing) return existing;
    const snapshot = await closingSnapshot(tx, period);
    if (fingerprint(snapshot) !== expectedHash) throw new FinancialOperationError('Os valores mudaram. Revise o fechamento novamente.');
    const closing = await tx.financialClosing.create({ data: { period, closedById: admin.id, closedAt: new Date(),
      snapshotJson: JSON.stringify(snapshot), financialText: formatFinancialClosing(snapshot), commissionText: formatClosingCommissions(snapshot),
      sellers: { create: snapshot.sellers.map(seller => ({ sellerId: seller.sellerId, amount: money(seller.net) })) },
    } });
    for (const adjustment of snapshot.adjustments) {
      const claimed = await tx.commissionAdjustment.updateMany({ where: { id: adjustment.id, closingId: null },
        data: { closingId: closing.id, amount: money(adjustment.amount) } });
      if (claimed.count !== 1) throw new FinancialOperationError('Um ajuste já foi incluído em outro fechamento.');
    }
    return closing;
  }));
}

export async function readFinancialClosing(actorPhone: string, period: string) {
  await assertFinancialAdministrator(actorPhone);
  const closing = await prisma.financialClosing.findUnique({ where: { period }, include: { sellers: { include: { seller: true }, orderBy: { sellerId: 'asc' } } } });
  if (!closing) throw new FinancialOperationError('Fechamento não encontrado.');
  return closing;
}

export async function markClosingCommissionPaid(actorPhone: string, period: string, sellerPosition: number) {
  return withInventoryMutationLock(() => prisma.$transaction(async tx => {
    const admin = await assertFinancialAdministrator(actorPhone, tx);
    const closing = await tx.financialClosing.findUnique({ where: { period }, include: { sellers: { orderBy: { sellerId: 'asc' } } } });
    const seller = Number.isSafeInteger(sellerPosition) && sellerPosition > 0 ? closing?.sellers[sellerPosition - 1] : null;
    if (!seller || Number(seller.amount) <= 0) throw new FinancialOperationError('Selecione uma comissão positiva do fechamento.');
    if (!seller.paidAt) await tx.financialClosingSeller.update({ where: { id: seller.id }, data: { paidAt: new Date(), paidById: admin.id } });
    return tx.financialClosingSeller.findUniqueOrThrow({ where: { id: seller.id } });
  }));
}
