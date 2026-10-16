import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { formatPriceTypeQuestion, formatSaleConfirmation } from '../src/commands/saleFormatting.js';
import { parsePriceType } from '../src/commands/saleParsers.js';
import { appendPricedSaleItem, buildPersistedSaleItems } from '../src/utils/saleSessionHelpers.js';
import { handleSaleConversation } from '../src/commands/saleCommand.js';
import { saveSaleSession, getSaleSession, clearSaleSession, type SaleSession } from '../src/utils/saleSessionStore.js';

const base: SaleSession = { userId: 'ten-user', chatId: 'ten-chat', step: 'awaiting_price_type', productId: 'ten-product', reference: '175/70 R14', description: 'TESTE', quantity: 2, cashPrice: 718, creditPrice: 753.90, tenInstallmentPrice: 800.90, updatedAt: Date.now() };
test('10X is the total price per product, multiplied by quantity, not an installment amount', () => {
  assert.equal(parsePriceType('3'), '10X');
  assert.equal(parsePriceType('10X'), '10X');
  assert.match(formatPriceTypeQuestion(base), /3️⃣ 💳 10X: \*R\$1601,80\*/);
  const sale = appendPricedSaleItem(base, '10X');
  assert.equal(sale.totalValue, 1601.80);
  assert.equal(sale.items![0]!.priceType, '10X');
  assert.equal(buildPersistedSaleItems(sale)[0]!.unitPrice, 800.90);
  assert.match(formatSaleConfirmation({ ...sale, paymentMethod: 'Cartão' }), /10X/);
  assert.doesNotMatch(formatPriceTypeQuestion({ ...base, tenInstallmentPrice: null }), /3️⃣/);
  assert.throws(() => appendPricedSaleItem({ ...base, tenInstallmentPrice: null }, '10X'));
});
test('option 3 advances the actual sale and rejects unavailable 10X prices', async () => {
  const message = { author: base.userId, from: base.chatId, reply: async () => undefined } as unknown as Message;
  try {
    saveSaleSession(base);
    await handleSaleConversation(message, '3');
    assert.equal(getSaleSession(base.userId, base.chatId)?.step, 'awaiting_payment');
    assert.equal(getSaleSession(base.userId, base.chatId)?.totalValue, 1601.80);
    saveSaleSession({ ...base, tenInstallmentPrice: null });
    await handleSaleConversation(message, '3');
    assert.equal(getSaleSession(base.userId, base.chatId)?.step, 'awaiting_price_type');
  } finally { clearSaleSession(base.userId, base.chatId); }
});
