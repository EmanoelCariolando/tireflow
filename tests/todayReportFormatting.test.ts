import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTodayReport } from '../src/services/reportService.js';

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
  });

  assert.match(report, /💰 \*FATURAMENTO: R\$1220,00\*/);
  assert.match(report, /Vendas: \*4\* \| Entradas: \*2\*/);
  assert.match(report, /Ajustes: \*1\* \| Preços: \*3\*/);
  assert.match(report, /\*175\/70 R14\* — \*PIRELLI FORMULA EVO\*/);
  assert.match(report, /Quantidade: \*3 unidades\*/);
  assert.doesNotMatch(report, /Sem movimentações registradas/);
});
