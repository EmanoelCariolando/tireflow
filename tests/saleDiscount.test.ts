import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { handleSaleConversation } from '../src/commands/saleCommand.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
} from '../src/utils/saleSessionStore.js';

function startSale(suffix: string): { userId: string; chatId: string } {
  const ids = {
    userId: `sale-discount-user-${suffix}`,
    chatId: `sale-discount-chat-${suffix}`,
  };
  saveSaleSession({
    ...ids,
    step: 'awaiting_price_type',
    productId: `sale-discount-product-${suffix}`,
    reference: '175/70 R14',
    description: 'PNEU TESTE',
    quantity: 2,
    cashPrice: 500,
    creditPrice: 550,
    updatedAt: Date.now(),
  });
  return ids;
}

function createMessage(
  ids: { userId: string; chatId: string },
  replies: string[],
  imageId?: string
): Message {
  return {
    author: ids.userId,
    from: ids.chatId,
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

test('applies one confirmed 3% discount and returns to the payment menu', async () => {
  const ids = startSale('confirmed');
  const replies: string[] = [];
  const message = createMessage(ids, replies);

  await handleSaleConversation(message, '1');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_payment');
  assert.match(replies.at(-1) ?? '', /Valor selecionado: \*À vista\*/);
  assert.match(replies.at(-1) ?? '', /Total: \*R\$1000,00\*/);

  await handleSaleConversation(message, '6');
  const previewSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(previewSession?.step, 'awaiting_discount_confirmation');
  assert.equal(previewSession?.originalTotalValue, 1000);
  assert.equal(previewSession?.totalValue, 970);
  assert.equal(previewSession?.discountPercent, 3);
  assert.match(replies.at(-1) ?? '', /Desconto de 3%: -R\$30,00/);
  assert.match(replies.at(-1) ?? '', /Novo total: \*R\$970,00\*/);

  await handleSaleConversation(message, 'confirma');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_payment');
  assert.match(replies.at(-1) ?? '', /Total com desconto: \*R\$970,00\*/);

  await handleSaleConversation(message, '6');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.totalValue, 970);
  assert.match(replies.at(-1) ?? '', /já foi aplicado/);

  await handleSaleConversation(message, '1');
  const receiptSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(receiptSession?.step, 'awaiting_photo');
  assert.deepEqual(receiptSession?.pendingReceiptMethods, ['Dinheiro']);
  assert.match(replies.at(-1) ?? '', /foto do depósito\/dinheiro/);

  await handleSaleConversation(message, 'confirmar');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_photo');
  assert.match(replies.at(-1) ?? '', /foto do depósito\/dinheiro para continuar/);

  await handleSaleConversation(createMessage(ids, replies, 'cash-receipt'), '');
  const confirmationSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(confirmationSession?.step, 'awaiting_confirmation');
  assert.equal(confirmationSession?.paymentMethod, 'Dinheiro');
  assert.equal(confirmationSession?.totalValue, 970);
  assert.equal(confirmationSession?.receipts?.[0]?.paymentMethod, 'Dinheiro');
  assert.match(replies.at(-1) ?? '', /Desconto: \*3% \(-R\$30,00\)\*/);
  assert.match(replies.at(-1) ?? '', /Total: \*R\$970,00\*/);

  clearSaleSession(ids.userId, ids.chatId);
});

test('selects the price once before any direct payment method', async () => {
  const cardIds = startSale('card');
  const cardReplies: string[] = [];
  const cardMessage = createMessage(cardIds, cardReplies);

  await handleSaleConversation(cardMessage, '1');
  assert.equal(getSaleSession(cardIds.userId, cardIds.chatId)?.step, 'awaiting_payment');
  await handleSaleConversation(cardMessage, '3');
  const cardSession = getSaleSession(cardIds.userId, cardIds.chatId);
  assert.equal(cardSession?.step, 'awaiting_photo');
  assert.equal(cardSession?.priceType, 'À vista');
  assert.equal(cardSession?.totalValue, 1000);
  clearSaleSession(cardIds.userId, cardIds.chatId);

  const noteIds = startSale('note');
  const noteReplies: string[] = [];
  const noteMessage = createMessage(noteIds, noteReplies);
  await handleSaleConversation(noteMessage, '2');
  await handleSaleConversation(noteMessage, '4');
  const noteSession = getSaleSession(noteIds.userId, noteIds.chatId);
  assert.equal(noteSession?.step, 'awaiting_photo');
  assert.equal(noteSession?.priceType, 'A prazo');
  assert.equal(noteSession?.totalValue, 1100);
  clearSaleSession(noteIds.userId, noteIds.chatId);

  const pixIds = startSale('pix');
  const pixReplies: string[] = [];
  const pixMessage = createMessage(pixIds, pixReplies);
  await handleSaleConversation(pixMessage, '2');
  await handleSaleConversation(pixMessage, '2');
  const pixSession = getSaleSession(pixIds.userId, pixIds.chatId);
  assert.equal(pixSession?.step, 'awaiting_photo');
  assert.equal(pixSession?.priceType, 'A prazo');
  assert.equal(pixSession?.totalValue, 1100);
  clearSaleSession(pixIds.userId, pixIds.chatId);
});

test('keeps the initially selected price for a mixed payment with card', async () => {
  const ids = startSale('mixed-card');
  const replies: string[] = [];
  const message = createMessage(ids, replies);

  await handleSaleConversation(message, '2');
  await handleSaleConversation(message, '5');
  await handleSaleConversation(message, '1 e 3');
  const session = getSaleSession(ids.userId, ids.chatId);
  assert.equal(session?.step, 'awaiting_mixed_amount');
  assert.equal(session?.priceType, 'A prazo');
  assert.equal(session?.totalValue, 1100);
  assert.match(replies.at(-1) ?? '', /Quanto foi pago em Cartão/);

  clearSaleSession(ids.userId, ids.chatId);
});
