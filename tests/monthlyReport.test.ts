import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { MovementType, Prisma } from '@prisma/client';
import type { ReportPendingSale } from '../src/repositories/pendingSaleReportRepository.js';
import {
  formatCommissionReport,
  buildDailyMovementHistory,
  formatMonthlyReport,
  getCommissionPeriod,
  getPreviousMonthPeriod,
  summarizeCommissionReport,
  summarizeMonthlyReport,
  type MonthlyMovementWithRelations,
} from '../src/services/monthlyReportService.js';
import {
  isCommissionReportDue,
  isMonthlyReportDue,
} from '../src/services/monthlyReportScheduler.js';
import {
  buildMonthlyInventoryPdf,
  getTireRim,
} from '../src/services/monthlyInventoryPdfService.js';

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
    saleGroupCode: null,
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
    commissionPercent: null,
    isCityHallSale: false,
    observation: null,
    supplier: null,
    reason: null,
    createdAt,
    product,
    user,
    ...overrides,
  };
}

test('daily history includes empty days, chronological movements and exclusive period boundaries', () => {
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 4), key: 'test' };
  const records = [
    movement('price', new Date(2026, 8, 1, 12), {
      type: MovementType.PRICE_CHANGE,
      observation: JSON.stringify({ oldCashPrice: 100, newCashPrice: 110, oldCreditPrice: 120, newCreditPrice: 130 }),
    }),
    movement('entry', new Date(2026, 8, 1, 10), { type: MovementType.ENTRY, quantity: 4, user: maria }),
    movement('sale', new Date(2026, 8, 1), { quantity: 2 }),
    movement('adjustment', new Date(2026, 8, 3, 23, 59), { type: MovementType.ADJUSTMENT, previousStock: 4, newStock: 3 }),
    movement('before', new Date(2026, 7, 31, 23, 59)),
    movement('after', period.end),
  ];
  const history = buildDailyMovementHistory(period, records);
  assert.equal(history.length, 3);
  assert.equal(history[0].entries.length, 3);
  assert.match(history[0].entries[0], /00:00 - João vendeu 2 un\. de 175\/70 R14 DYNAMO/);
  assert.match(history[0].entries[1], /Maria deu entrada em 4 un\./);
  assert.match(history[0].entries[2], /100,00 para R\$\s*110,00; a prazo R\$\s*120,00 para R\$\s*130,00/);
  assert.deepEqual(history[1].entries, []);
  assert.match(history[2].entries[0], /4 para 3 un\./);
  assert.equal(records[0].id, 'price');
  for (const observation of [null, 'invalid JSON', '{}', 'null']) {
    const legacy = buildDailyMovementHistory(period, [movement('legacy', period.start, {
      type: MovementType.PRICE_CHANGE, observation,
    })]);
    assert.match(legacy[0].entries[0], /detalhes anteriores não disponíveis/);
  }
  assert.equal(buildDailyMovementHistory(getPreviousMonthPeriod(new Date(2028, 2, 1)), []).length, 29);
});

test('pending history tracks opening, zero stock, later sale and return on the actual days', () => {
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 6), key: 'test' };
  const pending: ReportPendingSale = {
    code: '#PD-000001', createdAt: new Date(2026, 8, 1, 9), resolvedAt: new Date(2026, 8, 4, 10),
    status: 'SOLD', completedSaleGroupCode: '#V-000001', createdBy: { name: 'Laudemy' }, assignedTo: { name: 'Manel' },
    items: [{ productId: productOne.id, reference: productOne.reference, description: productOne.description,
      quantity: 2, previousStock: 2, reservedStock: 0, product: { stockLocation: null, category: 'TIRE' } }],
  };
  const sale = movement('closing', pending.resolvedAt!, { saleGroupCode: pending.completedSaleGroupCode,
    quantity: 2, previousStock: 2, newStock: 0, totalValue: new Prisma.Decimal(600), paymentMethod: 'PIX' });
  const refill = movement('refill', new Date(2026, 8, 2, 8), {
    type: MovementType.ENTRY, quantity: 5, previousStock: 0, newStock: 5, supplier: 'Fornecedor teste', invoiceNumber: '123',
  });
  const history = buildDailyMovementHistory(period, [sale, refill], [pending]);
  assert.match(history[0].entries[0], /Laudemy abriu a pendência para Manel/);
  assert.match(history[0].entries[0], /ESTOQUE ZERADO pela reserva/);
  assert.doesNotMatch(history[0].entries[0], /fechou|vendeu/);
  assert.match(history[1].entries[0], /Fornecedor teste.*Nota: 123.*ESTOQUE REPOSTO/);
  assert.match(history[3].entries[0], /João vendeu 2 un\..*e fechou a pendência, aberta em 01\/09\/2026/);
  assert.doesNotMatch(JSON.stringify(history), /#PD-/);
  assert.doesNotMatch(history[3].entries[0], /ESTOQUE ZERADO|Estoque: 2 para 0/);
  assert.match(history[3].entries[0], /600,00.*PIX/);
  assert.deepEqual(history[4].entries, []);
  const summary = summarizeMonthlyReport(period, [sale, refill], [], 2, false, [pending]);
  assert.equal(summary.saleCount, 1);
  assert.equal(summary.totalRevenue, 600);
  assert.equal(summary.zeroStockProducts.length, 1);
  assert.equal(summary.zeroStockProducts[0].zeroedAt.getTime(), pending.createdAt.getTime());
  assert.equal(summary.zeroStockProducts[0].endedAtZero, false);

  const closingPeriod = { ...period, start: new Date(2026, 8, 4) };
  const closingHistory = buildDailyMovementHistory(closingPeriod, [sale], [pending]);
  assert.equal(closingHistory[0].entries.length, 1);
  assert.match(closingHistory[0].entries[0], /aberta em 01\/09\/2026/);
  assert.equal(summarizeMonthlyReport(closingPeriod, [sale], [], 2, false, [pending]).zeroStockProducts.length, 0);
  const returned = { ...pending, status: 'RETURNED' as const, completedSaleGroupCode: null };
  const returnMovement = movement('returned', pending.resolvedAt!, { type: MovementType.ADJUSTMENT,
    quantity: 2, previousStock: 0, newStock: 2, observation: 'Retorno da pendência #PD-000001',
    reason: 'Produto não vendido e devolvido ao estoque' });
  const returns = buildDailyMovementHistory(period, [returnMovement], [returned]);
  assert.equal(returns[3].entries.length, 1);
  assert.match(returns[3].entries[0], /João devolveu 2 un\..*fechou a pendência sem venda.*ESTOQUE REPOSTO/);
  assert.doesNotMatch(JSON.stringify(returns), /#PD-/);
  const openingOnly = buildDailyMovementHistory({ ...period, end: new Date(2026, 8, 2) }, [sale], [pending]);
  assert.equal(openingOnly[0].entries.length, 1);
  assert.doesNotMatch(openingOnly[0].entries[0], /fechou/);
});

function pdfPageTexts(pdf: Buffer): string[] {
  return [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    const stream = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    return [...stream.matchAll(/<([0-9a-f]+)>/gi)].map((text) => Buffer.from(text[1], 'hex').toString('latin1')).join('');
  });
}

test('monthly PDF paginates complete daily history and keeps it out of current stock PDF', async () => {
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 3), key: 'test' };
  const records = Array.from({ length: 180 }, (_, index) => movement(String(index), new Date(2026, 8, 1, 9, index), {
    quantity: 1,
    product: { ...productOne, description: `REGISTRO${String(index).padStart(3, '0')} ${'Descricao longa '.repeat(index === 90 ? 500 : 5)}` },
  }));
  const report = summarizeMonthlyReport(period, records, [], 2, false);
  report.dailyHistory = buildDailyMovementHistory(period, records);
  const input = { report, products: [], branchName: 'TESTE', generatedAt: period.end };
  const pdf = await buildMonthlyInventoryPdf(input);
  const pages = pdfPageTexts(pdf);
  const text = pages.join('');
  assert.match(text, /HISTÓRICO DO PERÍODO/);
  assert.match(text, /PRODUTOS MAIS VENDIDOS/);
  assert.match(text, /DIA 02\/09\/2026Sem movimentação/);
  for (let index = 0; index < 180; index++) {
    assert.ok(text.includes(`REGISTRO${String(index).padStart(3, '0')}`));
  }
  assert.ok(pages.length > 5 && pages.length < 35, `Unexpected page count: ${pages.length}`);
  assert.ok(pages.every((page) => page.includes('Página') && page.length > 80));
  assert.ok(pdf.length < 500_000);
  const stock = pdfPageTexts(await buildMonthlyInventoryPdf({ ...input, mode: 'stock' })).join('');
  assert.doesNotMatch(stock, /HISTÓRICO DO PERÍODO|REGISTRO/);
  assert.match(stock, /PNEUS EM ESTOQUE ATUAL/);
});

test('counts grouped item movements as one sale while preserving units and revenue', () => {
  const period = getPreviousMonthPeriod(new Date(2026, 7, 1, 8, 0));
  const groupedSales = [
    movement('grouped-one', new Date(2026, 6, 5, 10, 0), {
      saleGroupCode: '#V-000100',
      quantity: 1,
      totalValue: new Prisma.Decimal(100),
      paymentMethod: 'PIX',
    }),
    movement('grouped-two', new Date(2026, 6, 5, 10, 0), {
      saleGroupCode: '#V-000100',
      product: productTwo,
      productId: productTwo.id,
      quantity: 1,
      totalValue: new Prisma.Decimal(250),
      paymentMethod: 'PIX',
    }),
  ];

  const summary = summarizeMonthlyReport(period, groupedSales, [], 2, true);
  assert.equal(summary.saleCount, 1);
  assert.equal(summary.movementCounts.sale, 1);
  assert.equal(summary.sellers[0]?.saleCount, 1);
  assert.equal(summary.unitsSold, 2);
  assert.equal(summary.totalRevenue, 350);
  assert.equal(summary.paymentTotals.PIX, 350);
});

test('sends only the financial summary in text and moves inventory details to a PDF', async () => {
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
  assert.equal(reports.length, 1);
  assert.match(reports[0]!, /FATURAMENTO MENSAL — JULHO\/2026/);
  assert.match(reports[0]!, /Faturamento: \*R\$900,00\*/);
  assert.match(reports[0]!, /Dinheiro: \*R\$200,00\*/);
  assert.doesNotMatch(reports.join('\n'), /DESEMPENHO DA EQUIPE|Comissão|Comissões/);
  assert.doesNotMatch(reports.join('\n'), /João|Maria/);

  const inventoryProducts = Array.from({ length: 80 }, (_, index) => ({
    id: `inventory-${index}`,
    reference: `${175 + index}/70 R14`,
    description: `PNEU PARA CONFERÊNCIA ${index + 1}`,
    stock: index + 1,
    stockLocation: index % 2 === 0 ? 'PMAIS' : 'W3',
  }));
  const pdf = await buildMonthlyInventoryPdf({
    mode: 'stock',
    report: summary,
    products: inventoryProducts,
    branchName: 'ATC PNEUS MONTEIRO',
    generatedAt: new Date(2026, 7, 1, 8, 0),
  });
  const pdfSource = pdf.toString('latin1');
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(pdfSource, /%%EOF/);
  const pageCount = (pdfSource.match(/\/Type \/Page\b/g) ?? []).length;
  const mediaBoxes = [...pdfSource.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(
    (match) => match[1]
  );
  assert.ok(pageCount >= 3);
  assert.ok(pageCount <= 10, `PDF should not contain overflow pages; received ${pageCount}`);
  assert.equal(mediaBoxes.length, pageCount);
  assert.ok(mediaBoxes.every((mediaBox) => mediaBox === '0 0 841.89 595.28'));
  assert.ok(pdf.length > 5_000 && pdf.length < 2_000_000);

  const overflowPdf = await buildMonthlyInventoryPdf({
    report: {
      ...summary,
      zeroStockProducts: Array.from({ length: 35 }, (_, index) => ({
        ...summary.zeroStockProducts[0]!,
        reference: `ZERADO-${index + 1}`,
        description: `PNEU ZERADO PARA PAGINAÇÃO ${index + 1}`,
      })),
    },
    products: inventoryProducts,
    branchName: 'ATC PNEUS MONTEIRO',
    generatedAt: new Date(2026, 7, 1, 8, 0),
  });
  const overflowSource = overflowPdf.toString('latin1');
  const overflowPageCount = (overflowSource.match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(overflowPageCount >= 2 && overflowPageCount <= 5);
});

test('identifies passenger, truck and agricultural tire rims for inventory grouping', () => {
  assert.equal(getTireRim('175/70 R14'), 14);
  assert.equal(getTireRim('295/80R22.5'), 22.5);
  assert.equal(getTireRim('8.3/24'), 24);
  assert.equal(getTireRim('10-16.5'), 16.5);
  assert.equal(getTireRim('RODA 17.5X6.00'), 17.5);
  assert.equal(getTireRim('RODA'), null);
});

test('excludes city hall invoices from commission without removing their revenue', () => {
  const period = getCommissionPeriod(new Date(2026, 7, 20, 8, 0));
  const sales = [
    movement('city-hall-note', new Date(2026, 6, 25, 10, 0), {
      quantity: 2,
      totalValue: new Prisma.Decimal(600),
      paymentMethod: 'Nota',
      invoiceName: 'Prefeitura de Congo',
      isCityHallSale: true,
    }),
    movement('customer-note', new Date(2026, 7, 10, 10, 0), {
      quantity: 1,
      totalValue: new Prisma.Decimal(400),
      paymentMethod: 'Nota',
      invoiceName: 'Cliente Teste',
      isCityHallSale: false,
    }),
  ];

  const summary = summarizeCommissionReport(period, sales, 2);

  assert.equal(summary.sellers[0]?.totalValue, 1000);
  assert.equal(summary.sellers[0]?.commissionBase, 400);
  assert.equal(summary.sellers[0]?.standardCommissionBase, 400);
  assert.equal(summary.sellers[0]?.discountedCommissionBase, 0);
  assert.equal(summary.sellers[0]?.cityHallSalesValue, 600);
  assert.equal(summary.sellers[0]?.standardCommission, 8);
  assert.equal(summary.sellers[0]?.discountedCommission, 0);
  assert.equal(summary.sellers[0]?.commission, 8);
  const report = formatCommissionReport(summary);
  assert.match(report, /Período: 01\/07\/2026 a 31\/07\/2026/);
  assert.match(report, /Vendas: \*2\* \| Itens: \*3\* \| Total: \*R\$1000,00\*/);
  assert.match(report, /Comissão 2%: \*R\$8,00\* \(base R\$400,00\)/);
  assert.match(report, /Comissão 1%: \*R\$0,00\* \(base R\$0,00\)/);
  assert.match(report, /Prefeitura 0%: \*R\$600,00\*/);
  assert.match(report, /Comissão total: \*R\$8,00\*/);
});

test('pays 2 percent on regular sales and 1 percent on discounted sales', () => {
  const period = getCommissionPeriod(new Date(2026, 8, 20, 8, 0));
  const sales = [
    movement('regular-sale', new Date(2026, 7, 10, 10, 0), {
      quantity: 1,
      totalValue: new Prisma.Decimal(1_000),
      commissionPercent: new Prisma.Decimal(2),
    }),
    movement('discounted-sale', new Date(2026, 7, 11, 10, 0), {
      quantity: 1,
      totalValue: new Prisma.Decimal(500),
      commissionPercent: new Prisma.Decimal(1),
    }),
    movement('city-hall-sale', new Date(2026, 7, 12, 10, 0), {
      quantity: 1,
      totalValue: new Prisma.Decimal(200),
      commissionPercent: new Prisma.Decimal(0),
      isCityHallSale: true,
    }),
  ];

  const summary = summarizeCommissionReport(period, sales, 2);
  const seller = summary.sellers[0]!;

  assert.equal(seller.totalValue, 1_700);
  assert.equal(seller.standardCommissionBase, 1_000);
  assert.equal(seller.standardCommission, 20);
  assert.equal(seller.discountedCommissionBase, 500);
  assert.equal(seller.discountedCommission, 5);
  assert.equal(seller.cityHallSalesValue, 200);
  assert.equal(seller.commission, 25);

  const report = formatCommissionReport(summary);
  assert.match(report, /Comissão 2%: \*R\$20,00\* \(base R\$1000,00\)/);
  assert.match(report, /Comissão 1%: \*R\$5,00\* \(base R\$500,00\)/);
  assert.match(report, /Prefeitura 0%: \*R\$200,00\*/);
});

test('keeps the financial message independent from stock-location configuration', () => {
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

  assert.equal(formatMonthlyReport(summary).length, 1);
  assert.doesNotMatch(formatMonthlyReport(summary)[0]!, /📍 Local:/);
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

test('closes commissions for the complete previous calendar month and sends on day 20', () => {
  const period = getCommissionPeriod(new Date(2026, 8, 20, 8, 0));
  assert.equal(period.key, '2026-08');
  assert.equal(period.start.getTime(), new Date(2026, 7, 1).getTime());
  assert.equal(period.end.getTime(), new Date(2026, 8, 1).getTime());

  assert.equal(isCommissionReportDue(new Date(2026, 8, 20, 7, 59), '08:00'), false);
  assert.equal(isCommissionReportDue(new Date(2026, 8, 20, 8, 0), '08:00'), true);
  assert.equal(isCommissionReportDue(new Date(2026, 8, 19, 12, 0), '08:00'), false);
  assert.equal(isCommissionReportDue(new Date(2026, 8, 25, 12, 0), '08:00'), true);
  assert.equal(isCommissionReportDue(new Date(2026, 8, 20, 8, 0), '25:00'), false);
});

test('monthly scheduler sends only through the required private boss channel', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src', 'services', 'monthlyReportScheduler.ts'),
    'utf8'
  );
  assert.match(source, /sendRequiredBossTextNotification/);
  assert.match(source, /sendRequiredBossMediaNotification/);
  assert.match(source, /application\/pdf/);
  assert.match(source, /BOSS_PRIVATE_NUMBER/);
  assert.doesNotMatch(source, /sendOwnerNotification/);
  assert.doesNotMatch(source, /WHATSAPP_OFFICIAL_GROUP_ID/);
  assert.doesNotMatch(source, /message\.reply/);
});
