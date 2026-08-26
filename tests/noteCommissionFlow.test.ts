import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { handleSaleConversation } from '../src/commands/saleCommand.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
} from '../src/utils/saleSessionStore.js';

const userId = 'note-commission-user';
const chatId = 'note-commission-chat';

function createMessage(replies: string[], imageId?: string): Message {
  return {
    author: userId,
    from: chatId,
    hasMedia: Boolean(imageId),
    type: imageId ? 'image' : 'chat',
    id: imageId ? { _serialized: imageId } : undefined,
    rawData: {},
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;
}

test('asks whether a received note has commission before requesting its name', async () => {
  const replies: string[] = [];
  saveSaleSession({
    userId,
    chatId,
    step: 'awaiting_photo',
    productId: 'note-product',
    reference: '175/70 R14',
    description: 'PNEU TESTE',
    quantity: 1,
    cashPrice: 300,
    creditPrice: 320,
    unitPrice: 300,
    totalValue: 300,
    paymentMethod: 'Nota',
    pendingReceiptMethods: ['Nota'],
    receipts: [],
    updatedAt: Date.now(),
  });

  await handleSaleConversation(createMessage(replies, 'note-image'), '');
  assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_city_hall_confirmation');
  assert.equal(
    replies.at(-1),
    '✅ Nota recebida.\n\n💵 *Comissão*\n*Essa Nota Tem Comissão?*\n1️⃣ *Sim* | 2️⃣ *Não*'
  );

  await handleSaleConversation(createMessage(replies), '2');
  assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_invoice_name');
  assert.equal(getSaleSession(userId, chatId)?.isCityHallSale, true);
  assert.match(replies.at(-1) ?? '', /NOME DA NOTA/);

  await handleSaleConversation(createMessage(replies), 'Prefeitura de Congo');
  const confirmation = getSaleSession(userId, chatId);
  assert.equal(confirmation?.step, 'awaiting_confirmation');
  assert.equal(confirmation?.isCityHallSale, true);
  assert.match(replies.at(-1) ?? '', /Prefeitura \(sem comissão\)/);

  clearSaleSession(userId, chatId);
});

test('keeps the transfer payment option disabled', async () => {
  const replies: string[] = [];
  const message = createMessage(replies);
  saveSaleSession({
    userId,
    chatId,
    step: 'awaiting_payment',
    productId: 'note-product',
    reference: '175/70 R14',
    description: 'PNEU TESTE',
    quantity: 1,
    cashPrice: 300,
    creditPrice: 320,
    unitPrice: 300,
    totalValue: 300,
    paymentMethod: undefined,
    updatedAt: Date.now(),
  });

  await handleSaleConversation(message, '8');
  assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_payment');
  assert.equal(getSaleSession(userId, chatId)?.paymentMethod, undefined);
  assert.match(replies.at(-1) ?? '', /Forma de pagamento inválida/);
  assert.doesNotMatch(replies.at(-1) ?? '', /Transferencia/);

  clearSaleSession(userId, chatId);
});
