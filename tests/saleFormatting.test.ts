import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBossSaleNotification,
  formatRegisteredSale,
  formatSaleConfirmation,
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
  receiptMessageId: 'receipt-id',
  updatedAt: Date.now(),
};

test('highlights and separates the total before sale confirmation', () => {
  const message = formatSaleConfirmation(session);

  assert.match(message, /^⚠️ \*CONFIRMAR VENDA\?\*/);
  assert.match(
    message,
    /\*175\/70 R14\* — \*PNEU TESTE\*\n\*2 unidades\* × R\$300,00\nPagamento: PIX\n\n💰 \*TOTAL: R\$600,00\*\n\nDigite: confirmar ou cancelar$/
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
