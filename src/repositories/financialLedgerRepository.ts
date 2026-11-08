import { prisma } from '../database/prisma.js';
import { getFinancialMonth, getFinancialPeriod } from '../utils/financialPeriod.js';

export async function findClosedFinancialPeriod(start: Date, end: Date) {
  const period = getFinancialPeriod(getFinancialMonth(start));
  if (period.start.getTime() !== start.getTime() || period.end.getTime() !== end.getTime()) return null;
  return prisma.financialClosing.findUnique({ where: { period: period.key } });
}

export async function findFinancialRefunds(start: Date, end: Date) {
  const refunds = await prisma.saleReversal.findMany({
    where: { createdAt: { gte: start, lt: end } }, include: { items: true },
  });
  const paymentTotals = { Dinheiro: 0, PIX: 0, 'Cartão': 0, Nota: 0 };
  let totalInCents = 0;
  for (const refund of refunds) {
    totalInCents += Math.round(Number(refund.amount) * 100);
    for (const item of refund.items) {
      const parts = JSON.parse(item.paymentDetails) as Array<{ method: keyof typeof paymentTotals; amount: number }>;
      for (const part of parts) paymentTotals[part.method] += Math.round(part.amount * 100);
    }
  }
  return { total: totalInCents / 100,
    paymentTotals: { Dinheiro: paymentTotals.Dinheiro / 100, PIX: paymentTotals.PIX / 100,
      'Cartão': paymentTotals['Cartão'] / 100, Nota: paymentTotals.Nota / 100 } };
}
