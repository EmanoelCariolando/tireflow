import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBossSaleNotification,
  formatCityHallQuestion,
  formatRegisteredSale,
  formatSaleConfirmation,
  parseCityHallResponse,
} from '../src/commands/saleCommand.js';
import type { SaleSession } from '../src/utils/saleSessionStore.js';

const session: SaleSession = {
  userId: 'sale-format-user',
  chatId: 'sale-format-chat',
  step: 'awaiting_confirmation',
  productId: 'sale-format-product',
  reference: '175/70 R14',
  description: 'PNEU TESTE',
  quantity: 2,
  cashPrice: 300,
  creditPrice: 320,
  unitPrice: 300,
  totalValue: 600,
  paymentMethod: 'PIX',
  updatedAt: Date.now(),
};

test('highlights and separates the total before sale confirmation', () => {
  const message = formatSaleConfirmation(session);

  assert.match(message, /^⚠️ \*CONFIRMAR VENDA\?\*/);
  assert.match(
    message,
    /\*175\/70 R14\* — \*PNEU TESTE\*\n\*2 un\.\* × R\$300,00\nPagamento: \*PIX\*\n\n💰 Total: \*R\$600,00\*\n\nDigite: confirmar ou cancelar$/
  );
  assert.doesNotMatch(message, /Foto da nota\/comprovante: recebida/);
  assert.doesNotMatch(message, /━/);
});

test('highlights and separates the total after a registered sale', () => {
  const message = formatRegisteredSale(session, 'VEN-001', 'Vendedor', 8);

  assert.match(message, /^✅ \*VENDA REGISTRADA\*/);
  assert.match(
    message,
    /\*175\/70 R14\* — \*PNEU TESTE\*\n\*2 unidades\* × R\$300,00\nPagamento: PIX\n\n💰 \*TOTAL: R\$600,00\*\n\n📦 Estoque: 8\nMovimentação: VEN-001\nVendedor: Vendedor$/
  );
  assert.doesNotMatch(message, /━/);
});

test('uses the same compact emphasis in the private boss notification', () => {
  const message = formatBossSaleNotification(session, 'VEN-001', 'Vendedor', 8);

  assert.equal(
    message,
    [
      '🔔 *NOVA VENDA*',
      '',
      '*175/70 R14* — *PNEU TESTE*',
      '*2 unidades* × R$300,00',
      'Pagamento: PIX',
      '',
      '💰 *TOTAL: R$600,00*',
      '',
      '📦 Estoque: 8',
      'Movimentação: VEN-001',
      'Vendedor: Vendedor',
    ].join('\n')
  );
});

test('shows both mixed payment amounts in the confirmation', () => {
  const message = formatSaleConfirmation({
    ...session,
    paymentMethod: 'Misto',
    paymentBreakdown: [
      { method: 'PIX', amount: 300 },
      { method: 'Dinheiro', amount: 300 },
    ],
  });

  assert.match(
    message,
    /Pagamento: \*Misto\*\nPIX: \*R\$300,00\* \| Dinheiro: \*R\$300,00\*/
  );
  assert.match(message, /💰 Total: \*R\$600,00\*/);
});

test('accepts s or n for the city hall question and shows the commission rule', () => {
  assert.equal(parseCityHallResponse('s'), true);
  assert.equal(parseCityHallResponse('sim'), true);
  assert.equal(parseCityHallResponse('n'), false);
  assert.equal(parseCityHallResponse('não'), false);
  assert.equal(parseCityHallResponse('talvez'), null);
  assert.match(formatCityHallQuestion(), /prefeitura \(de Congo ou de outra cidade\)/);

  const cityHallConfirmation = formatSaleConfirmation({
    ...session,
    paymentMethod: 'Nota',
    invoiceName: 'Prefeitura de Congo',
    isCityHallSale: true,
  });
  const customerConfirmation = formatSaleConfirmation({
    ...session,
    paymentMethod: 'Nota',
    invoiceName: 'Cliente Teste',
    isCityHallSale: false,
  });

  assert.match(cityHallConfirmation, /Destino da nota: Prefeitura \(sem comissão\)/);
  assert.match(customerConfirmation, /Destino da nota: Cliente \(com comissão\)/);
});

test('shows the discount and chosen price clearly to the seller and owner', () => {
  const discountedSession: SaleSession = {
    ...session,
    priceType: 'À vista',
    unitPrice: 291,
    originalTotalValue: 600,
    totalValue: 582,
    discountPercent: 3,
  };

  const confirmation = formatSaleConfirmation(discountedSession);
  const ownerNotification = formatBossSaleNotification(
    discountedSession,
    'VEN-002',
    'Vendedor',
    6
  );

  assert.match(confirmation, /Pagamento: \*PIX\* \| Valor: \*À vista\*/);
  assert.match(confirmation, /Valor original: R\$600,00/);
  assert.match(confirmation, /Desconto: \*3% \(-R\$18,00\)\*/);
  assert.match(confirmation, /💰 Total: \*R\$582,00\*/);
  assert.match(ownerNotification, /Pagamento: PIX \| Valor: À vista/);
  assert.match(ownerNotification, /Desconto: 3% \(-R\$18,00\)/);
  assert.match(ownerNotification, /💰 \*TOTAL: R\$582,00\*/);
});
