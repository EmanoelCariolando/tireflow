import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { MovementType, Prisma } from '@prisma/client';
import {
  formatMonthlyReport,
  getPreviousMonthPeriod,
  summarizeMonthlyReport,
  type MonthlyMovementWithRelations,
} from '../src/services/monthlyReportService.js';
import { isMonthlyReportDue } from '../src/services/monthlyReportScheduler.js';

const joao = {
  id: 'user-joao',
  name: 'João',
  phone: '5583999990001',
  role: 'USER',
  isActive: true,
  createdAt: new Date(2026, 0, 1),
  updatedAt: new Date(2026, 0, 1),
};
const maria = { ...joao, id: 'user-maria', name: 'Maria', phone: '5583999990002' };
const productOne = {
  id: 'product-one',
  reference: '175/70 R14',
  description: 'DYNAMO 82T',
  imagePath: null,
  stockLocation: 'W3',
  stock: 0,
  minStock: 0,
  cashPrice: new Prisma.Decimal(300),
  creditPrice: new Prisma.Decimal(320),
  isActive: true,
  createdAt: new Date(2026, 0, 1),
  updatedAt: new Date(2026, 0, 1),
};
const productTwo = {
  ...productOne,
  id: 'product-two',
  reference: '185/65 R15',
  description: 'ONYX NY806',
  stockLocation: 'CG',
  stock: 5,
};

function movement(
  id: string,
  createdAt: Date,
  overrides: Partial<MonthlyMovementWithRelations> = {}
): MonthlyMovementWithRelations {
  const product = overrides.product ?? productOne;
  const user = overrides.user ?? joao;
  return {
    id,
    code: `MOV-${id}`,
    type: MovementType.SALE,
    productId: product.id,
    userId: user.id,
    quantity: null,
    previousStock: null,
    newStock: null,
    unitPrice: null,
    totalValue: null,
    paymentMethod: null,
    paymentDetails: null,
    invoiceName: null,
    observation: null,
    supplier: null,
    reason: null,
    createdAt,
    product,
    user,
    ...overrides,
  };
}

test('summarizes sellers, mixed payments, top tires and specific zero-stock events', () => {
  const period = getPreviousMonthPeriod(new Date(2026, 7, 1, 8, 0));
  const movements = [
    movement('sale-one', new Date(2026, 6, 5, 10, 0), {
      quantity: 2,
      previousStock: 2,
      newStock: 0,
      unitPrice: new Prisma.Decimal(300),
      totalValue: new Prisma.Decimal(600),
      paymentMethod: 'PIX',
    }),
    movement('sale-two', new Date(2026, 6, 10, 10, 0), {
      product: productTwo,
      user: maria,
      productId: productTwo.id,
      userId: maria.id,
      quantity: 1,
      previousStock: 1,
      newStock: 0,
      unitPrice: new Prisma.Decimal(300),
      totalValue: new Prisma.Decimal(300),
      paymentMethod: 'Misto',
      paymentDetails: JSON.stringify([
        { method: 'PIX', amount: 100 },
        { method: 'Dinheiro', amount: 200 },
      ]),
    }),
    movement('entry-two', new Date(2026, 6, 15, 10, 0), {
      type: MovementType.ENTRY,
      product: productTwo,
      productId: productTwo.id,
      quantity: 5,
      previousStock: 0,
      newStock: 5,
    }),
    movement('price-one', new Date(2026, 6, 20, 10, 0), {
      type: MovementType.PRICE_CHANGE,
      totalValue: new Prisma.Decimal(320),
    }),
  ];
  const previousMovements = [
    movement('previous-sale', new Date(2026, 5, 10, 10, 0), {
      quantity: 1,
      totalValue: new Prisma.Decimal(500),
      paymentMethod: 'Dinheiro',
    }),
  ];

  const summary = summarizeMonthlyReport(period, movements, previousMovements, 2, true);

  assert.equal(summary.totalRevenue, 900);
  assert.equal(summary.saleCount, 2);
  assert.equal(summary.unitsSold, 3);
  assert.deepEqual(summary.paymentTotals, {
    Dinheiro: 200,
    PIX: 700,
    Cartão: 0,
    Nota: 0,
  });
  assert.deepEqual(
    summary.sellers.map((seller) => [seller.name, seller.totalValue, seller.commission]),
    [
      ['João', 600, 12],
      ['Maria', 300, 6],
    ]
  );
  assert.equal(summary.bestSellers[0]?.reference, '175/70 R14');
  assert.equal(summary.zeroStockProducts.length, 2);
  assert.equal(
    summary.zeroStockProducts.find((product) => product.reference === '175/70 R14')?.endedAtZero,
    true
  );
  assert.equal(
    summary.zeroStockProducts.find((product) => product.reference === '185/65 R15')?.endedAtZero,
    false
  );

  const reports = formatMonthlyReport(summary);
  assert.equal(reports.length, 3);
  assert.match(reports[0]!, /RELATÓRIO MENSAL — JULHO\/2026/);
  assert.match(reports[0]!, /Faturamento: \*R\$900,00\*/);
  assert.match(reports[0]!, /Dinheiro: \*R\$200,00\*/);
  assert.match(reports[1]!, /Comissão \(2%\): \*R\$12,00\*/);
  assert.match(reports[1]!, /🥇 \*175\/70 R14\* — \*DYNAMO 82T\*/);
  assert.match(reports[2]!, /\*175\/70 R14\* — \*DYNAMO 82T\*/);
  assert.match(reports[2]!, /Situação no fechamento: \*Continua zerado\*/);
  assert.match(reports[2]!, /Reposto: \*15\/07\/2026\*/);
  assert.match(reports[2]!, /📍 Local: W3/);
});

test('omits Monteiro stock locations when the installation disables them', () => {
  const period = getPreviousMonthPeriod(new Date(2026, 7, 1, 8, 0));
  const summary = summarizeMonthlyReport(
    period,
    [movement('zero-congo', new Date(2026, 6, 5), {
      quantity: 1,
      previousStock: 1,
      newStock: 0,
      totalValue: new Prisma.Decimal(300),
      paymentMethod: 'Dinheiro',
    })],
    [],
    2,
    false
  );

  assert.doesNotMatch(formatMonthlyReport(summary)[2]!, /📍 Local:/);
});

test('uses the previous calendar month and catches up after the first-day time', () => {
  const januaryPeriod = getPreviousMonthPeriod(new Date(2027, 0, 1, 8, 0));
  assert.equal(januaryPeriod.key, '2026-12');
  assert.equal(januaryPeriod.start.getFullYear(), 2026);
  assert.equal(januaryPeriod.start.getMonth(), 11);

  assert.equal(isMonthlyReportDue(new Date(2026, 7, 1, 7, 59), '08:00'), false);
  assert.equal(isMonthlyReportDue(new Date(2026, 7, 1, 8, 0), '08:00'), true);
  assert.equal(isMonthlyReportDue(new Date(2026, 7, 3, 12, 0), '08:00'), true);
  assert.equal(isMonthlyReportDue(new Date(2026, 7, 1, 8, 0), '25:00'), false);
});

test('monthly scheduler sends only through the required private boss channel', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src', 'services', 'monthlyReportScheduler.ts'),
    'utf8'
  );
  assert.match(source, /sendRequiredBossTextNotification/);
  assert.match(source, /BOSS_PRIVATE_NUMBER/);
  assert.doesNotMatch(source, /sendOwnerNotification/);
  assert.doesNotMatch(source, /WHATSAPP_OFFICIAL_GROUP_ID/);
  assert.doesNotMatch(source, /message\.reply/);
});
