import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  handlePriceCommand,
  handlePriceConversation,
  isPriceCommand,
} from '../src/commands/priceCommand.js';
import { clearLastQuery, saveLastQuery } from '../src/utils/lastQueryStore.js';
import { clearPriceSession, getPriceSession } from '../src/utils/priceSessionStore.js';
import { calculateCreditPrice } from '../src/utils/productPricing.js';

function createMessage(userId: string, chatId: string, replies: string[]): Message {
  return {
    author: userId,
    from: chatId,
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;
}

test('accepts preco and preço commands', () => {
  assert.equal(isPriceCommand('preco 1'), true);
  assert.equal(isPriceCommand('PREÇO 12'), true);
  assert.equal(isPriceCommand('preço'), false);
});

test('calculates the credit price with 5.8 percent rounded to cents', () => {
  assert.equal(calculateCreditPrice(0), 0);
  assert.equal(calculateCreditPrice(335), 354.43);
  assert.equal(calculateCreditPrice(899.9), 952.09);
  assert.equal(calculateCreditPrice(1000), 1058);
});

test('asks only for cash price and proceeds directly to confirmation', async () => {
  const userId = 'automatic-price-user';
  const chatId = 'automatic-price-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
    saveLastQuery(userId, chatId, '175/70 R14', [{
      id: 'automatic-price-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      stock: 4,
      cashPrice: 900,
      creditPrice: 952.2,
    }]);

    await handlePriceCommand(message, 'preço 1');
    assert.equal(getPriceSession(userId, chatId)?.step, 'awaiting_cash_price');
    assert.equal(replies.at(-1), '💰 *PREÇO À VISTA*\nDigite o preço à vista:');

    await handlePriceConversation(message, '1000');
    const confirmation = getPriceSession(userId, chatId);
    assert.equal(confirmation?.step, 'awaiting_confirmation');
    assert.equal(confirmation?.newCashPrice, 1000);
    assert.equal(confirmation?.newCreditPrice, 1058);
    assert.match(replies.at(-1) ?? '', /À vista: R\$900,00 → \*R\$1000,00\* \| 💳 A prazo: R\$952,20 → \*R\$1058,00\*/);
    assert.match(replies.at(-1) ?? '', /1️⃣ ✅ Confirmar\n2️⃣ ↩️ Voltar\n0️⃣ ❌ Cancelar/);

    await handlePriceConversation(message, 'cancela');
    assert.equal(getPriceSession(userId, chatId), null);
  } finally {
    clearPriceSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});
