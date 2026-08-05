import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTodayReport,
  summarizeDailyZeroStock,
} from '../src/services/reportService.js';

const referenceDate = new Date('2026-07-27T12:00:00-03:00');

test('formats an empty daily report compactly while keeping every total', () => {
  const report = formatTodayReport({
    referenceDate,
    hasMovements: false,
    paymentTotals: {
      Dinheiro: 0,
      PIX: 0,
      Cartão: 0,
      Nota: 0,
    },
    totalRevenue: 0,
    movementCounts: {
      sale: 0,
      entry: 0,
      adjustment: 0,
      priceChange: 0,
    },
    zeroStockProducts: [],
  });

  assert.equal(
    report,
    [
      '📊 *RELATÓRIO DO DIA*',
      '27/07/2026',
      '',
      'Sem movimentações registradas.',
      '',
      '💰 *FATURAMENTO: R$0,00*',
      '',
      '*PAGAMENTOS*',
      'Dinheiro: *R$0,00*',
      'PIX: *R$0,00*',
      'Cartão: *R$0,00*',
      'Nota: *R$0,00*',
      '',
      '*MOVIMENTAÇÕES*',
      'Vendas: *0* | Entradas: *0*',
      'Ajustes: *0* | Preços: *0*',
      '',
      '*MAIS VENDIDO*',
      'Nenhum produto vendido hoje.',
      '',
      '⚠️ *ESTOQUE ZERADO NO DIA*',
      'Nenhum pneu ficou com estoque 0.',
      '',
      '_TireFlow • Relatório automático_',
    ].join('\n')
  );
});

test('highlights revenue, movement numbers and the best-selling tire', () => {
  const report = formatTodayReport({
    referenceDate,
    hasMovements: true,
    paymentTotals: {
      Dinheiro: 300,
      PIX: 600,
      Cartão: 320,
      Nota: 0,
    },
    totalRevenue: 1220,
    movementCounts: {
      sale: 4,
      entry: 2,
      adjustment: 1,
      priceChange: 3,
    },
    bestSeller: {
      reference: '175/70 R14',
      description: 'PIRELLI FORMULA EVO',
      quantity: 3,
    },
    zeroStockProducts: [
      {
        reference: '175/70 R14',
        description: 'PIRELLI FORMULA EVO',
        stockLocation: null,
      },
      {
        reference: '185/65 R15',
        description: 'CONTINENTAL POWERCONTACT',
        stockLocation: null,
      },
    ],
  });

  assert.match(report, /💰 \*FATURAMENTO: R\$1220,00\*/);
  assert.match(report, /Vendas: \*4\* \| Entradas: \*2\*/);
  assert.match(report, /Ajustes: \*1\* \| Preços: \*3\*/);
  assert.match(report, /\*175\/70 R14\* — \*PIRELLI FORMULA EVO\*/);
  assert.match(report, /Quantidade: \*3 unidades\*/);
  assert.match(report, /ESTOQUE ZERADO NO DIA/);
  assert.match(report, /🔴 \*175\/70 R14\* — \*PIRELLI FORMULA EVO\*/);
  assert.match(report, /🔴 \*185\/65 R15\* — \*CONTINENTAL POWERCONTACT\*/);
  assert.doesNotMatch(report, /Situação:/);
  assert.doesNotMatch(report, /Sem movimentações registradas/);
  assert.doesNotMatch(report, /Nenhum pneu ficou com estoque 0/);
});

test('lists only products that reached zero during the day, including those later replenished', () => {
  type DailyMovement = Parameters<typeof summarizeDailyZeroStock>[0][number];
  const movement = (
    productId: string,
    reference: string,
    previousStock: number,
    newStock: number,
    createdAt: string
  ): DailyMovement => ({
    productId,
    previousStock,
    newStock,
    createdAt: new Date(createdAt),
    product: {
      reference,
      description: `PNEU ${reference}`,
      stockLocation: null,
    },
  }) as unknown as DailyMovement;

  const summary = summarizeDailyZeroStock([
    movement('replenished', '175/70 R14', 2, 0, '2026-07-27T10:00:00-03:00'),
    movement('replenished', '175/70 R14', 0, 5, '2026-07-27T11:00:00-03:00'),
    movement('still-zero', '185/65 R15', 1, 0, '2026-07-27T12:00:00-03:00'),
    movement('already-zero', '195/55 R16', 0, 0, '2026-07-27T13:00:00-03:00'),
    movement('positive', '205/55 R16', 5, 3, '2026-07-27T14:00:00-03:00'),
  ]);

  assert.deepEqual(
    summary.map(({ reference }) => reference),
    ['175/70 R14', '185/65 R15']
  );
});
