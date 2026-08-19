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
    /\*175\/70 R14\* — \*PNEU TESTE\*\n\*2 un\.\* × R\$300,00\nPagamento: \*PIX\*\n\n💰 Total: \*R\$600,00\*\n\n1️⃣ ✅ Confirmar\n2️⃣ ↩️ Voltar\n0️⃣ ❌ Cancelar$/
  );
  assert.doesNotMatch(message, /Foto da nota\/comprovante: recebida/);
  assert.doesNotMatch(message, /━/);
});

test('highlights and separates the total after a registered sale', () => {
  const message = formatRegisteredSale(session, 'VEN-001', 'Vendedor', 8);

  assert.match(message, /^✅ \*VENDA REGISTRADA\*/);
  assert.match(
    message,
    /\*175\/70 R14\* — \*PNEU TESTE\*\n\*2 unidades\* × R\$300,00\nPagamento: \*PIX\*\n\n💰 \*TOTAL: R\$600,00\*\n\n📦 Estoque: \*8\*\nVendedor: Vendedor$/
  );
  assert.doesNotMatch(message, /VEN-001|Movimentação:/);
  assert.doesNotMatch(message, /━/);
});

test('uses the restored detailed format in the private boss notification', () => {
  const message = formatBossSaleNotification(session, 'VEN-001', 'Vendedor', 8);

  assert.equal(
    message,
    [
      '🔔 *NOVA VENDA*',
      '',
      '*175/70 R14* — *PNEU TESTE*',
      '*2 unidades* × R$300,00',
      'Pagamento: *PIX*',
      '',
      '💰 *TOTAL: R$600,00*',
      '',
      '📦 Estoque: *8*',
      'Vendedor: Vendedor',
    ].join('\n')
  );
  assert.doesNotMatch(message, /VEN-001|Movimentação:/);
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
    /Pagamento: \*Misto\*\n\*PIX\*: \*R\$300,00\* \| \*Dinheiro\*: \*R\$300,00\*/
  );
  assert.match(message, /💰 Total: \*R\$600,00\*/);
});

test('accepts s or n for the city hall question and shows the commission rule', () => {
  assert.equal(parseCityHallResponse('s'), true);
  assert.equal(parseCityHallResponse('sim'), true);
  assert.equal(parseCityHallResponse('n'), false);
  assert.equal(parseCityHallResponse('não'), false);
  assert.equal(parseCityHallResponse('talvez'), null);
  assert.match(formatCityHallQuestion(), /NOTA PARA PREFEITURA/);

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

  assert.match(cityHallConfirmation, /Destino da nota: \*Prefeitura \(sem comissão\)\*/);
  assert.match(customerConfirmation, /Destino da nota: \*Cliente \(com comissão\)\*/);
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
  assert.match(confirmation, /\*Desconto: 3%\* \(-R\$18,00\)/);
  assert.match(confirmation, /💰 Total: \*R\$582,00\*/);
  assert.match(ownerNotification, /Pagamento: \*PIX\* \| Valor: \*À vista\*/);
  assert.match(ownerNotification, /\*Desconto: 3%\* \(-R\$18,00\)/);
  assert.match(ownerNotification, /💰 \*TOTAL: R\$582,00\*/);
});

test('highlights every payment method in registered and private sale messages', () => {
  for (const paymentMethod of ['Dinheiro', 'PIX', 'Cartão', 'Nota'] as const) {
    const sale = { ...session, paymentMethod, priceType: 'À vista' as const };

    for (const message of [
      formatRegisteredSale(sale, 'VEN-010', 'Vendedor', 8),
      formatBossSaleNotification(sale, 'VEN-010', 'Vendedor', 8),
    ]) {
      assert.match(message, new RegExp(`Pagamento: \\*${paymentMethod}\\* \\| Valor: \\*À vista\\*`));
    }
  }

  const mixedSale: SaleSession = {
    ...session,
    paymentMethod: 'Misto',
    priceType: 'À vista',
    paymentBreakdown: [
      { method: 'PIX', amount: 300 },
      { method: 'Dinheiro', amount: 300 },
    ],
  };

  for (const message of [
    formatRegisteredSale(mixedSale, 'VEN-011', 'Vendedor', 8),
    formatBossSaleNotification(mixedSale, 'VEN-011', 'Vendedor', 8),
  ]) {
    assert.match(message, /Pagamento: \*Misto\* \| Valor: \*À vista\*/);
    assert.match(message, /\*PIX\*: \*R\$300,00\* \| \*Dinheiro\*: \*R\$300,00\*/);
  }
});
