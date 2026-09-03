import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { handleSaleConversation } from '../src/commands/saleCommand.js';
import { formatPaymentMenu, formatRegisteredSale } from '../src/commands/saleFormatting.js';
import { parsePaymentMethod } from '../src/commands/saleParsers.js';
import { getPendingReminderSlot } from '../src/services/pendingSaleReminderScheduler.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
  type SaleSession,
} from '../src/utils/saleSessionStore.js';

test('adds Pendência as option 8 and removes sale-changing actions while resolving it', () => {
  assert.equal(parsePaymentMethod('8'), 'Pendência');
  assert.equal(parsePaymentMethod('pendencia'), 'Pendência');
  assert.match(formatPaymentMenu(), /8️⃣ \*Pendência\*/);

  const resolvingSession = {
    pendingSaleId: 'pending-id',
    priceType: 'À vista',
    totalValue: 300,
  } as SaleSession;
  const menu = formatPaymentMenu(resolvingSession);
  assert.doesNotMatch(menu, /Pendência|Desconto|Adicionar outro pneu/);
  assert.match(menu, /1️⃣ \*Dinheiro\*/);
  assert.match(menu, /5️⃣ \*Pagamento misto\*/);
});

test('asks for exactly one mentioned employee before confirming a pending sale', async () => {
  const userId = 'pending-flow-user';
  const chatId = 'pending-flow-chat';
  const replies: string[] = [];
  const session: SaleSession = {
    userId,
    chatId,
    step: 'awaiting_payment',
    productId: 'product-id',
    reference: '175/70 R13',
    description: 'SPM MH01',
    quantity: 1,
    cashPrice: 300,
    creditPrice: 320,
    unitPrice: 300,
    totalValue: 300,
    priceType: 'À vista',
    updatedAt: Date.now(),
  };
  saveSaleSession(session);
  const message = {
    author: userId,
    from: chatId,
    hasMedia: false,
    type: 'chat',
    mentionedIds: [],
    rawData: {},
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
    getMentions: async () => [{
      id: { _serialized: '5583999999999@c.us' },
      pushname: 'Fulano',
    }],
  } as unknown as Message;

  await handleSaleConversation(message, '8');
  assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_pending_assignee');
  assert.match(replies.at(-1) ?? '', /Marque \*um funcionário\*/);

  message.mentionedIds = ['5583999999999@c.us'];
  await handleSaleConversation(message, '@Fulano');
  const confirmation = getSaleSession(userId, chatId);
  assert.equal(confirmation?.step, 'awaiting_confirmation');
  assert.equal(confirmation?.paymentMethod, 'Pendência');
  assert.equal(confirmation?.pendingAssigneeName, 'Fulano');
  assert.match(replies.at(-1) ?? '', /PENDÊNCIA — CONFIRMAR/);
  assert.match(replies.at(-1) ?? '', /pneus sairão do estoque/);
  clearSaleSession(userId, chatId);
});

test('marks a completed pending sale discreetly in both confirmations', () => {
  const session = {
    userId: 'seller', chatId: 'chat', step: 'awaiting_confirmation',
    productId: 'product', reference: '175/70 R13', description: 'SPM MH01',
    quantity: 1, cashPrice: 300, creditPrice: 320, unitPrice: 300,
    totalValue: 300, paymentMethod: 'PIX', wasPending: true, updatedAt: Date.now(),
  } satisfies SaleSession;
  assert.match(formatRegisteredSale(session, '#V-1', 'Fulano', 2), /⏳ _Estava pendente_/);
});

test('schedules pending reminders only at 09:30 and 16:00', () => {
  assert.equal(getPendingReminderSlot(new Date(2026, 8, 2, 9, 30)), '09:30');
  assert.equal(getPendingReminderSlot(new Date(2026, 8, 2, 16, 0)), '16:00');
  assert.equal(getPendingReminderSlot(new Date(2026, 8, 2, 9, 29)), null);
});
