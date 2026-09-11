import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { handleSaleConversation } from '../src/commands/saleCommand.js';
import {
  formatPaymentMenu,
  formatRegisteredSale,
  formatSaleConfirmation,
} from '../src/commands/saleFormatting.js';
import { parsePaymentMethod } from '../src/commands/saleParsers.js';
import { getPendingReminderSlot } from '../src/services/pendingSaleReminderScheduler.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
  type SaleSession,
} from '../src/utils/saleSessionStore.js';

test('offers discount and price change but removes item-changing actions while resolving a pending sale', () => {
  assert.equal(parsePaymentMethod('8'), 'Pendência');
  assert.equal(parsePaymentMethod('pendencia'), 'Pendência');
  assert.match(formatPaymentMenu(), /8️⃣ \*Pendência\*/);
  assert.doesNotMatch(formatPaymentMenu(), /Alterar preço/);

  const resolvingSession = {
    pendingSaleId: 'pending-id',
    priceType: 'À vista',
    totalValue: 300,
  } as SaleSession;
  const menu = formatPaymentMenu(resolvingSession);
  assert.match(menu, /6️⃣ \*Desconto\*/);
  assert.match(menu, /7️⃣ \*Alterar preço\*/);
  assert.doesNotMatch(menu, /Pendência|Adicionar outro pneu/);
  assert.match(menu, /1️⃣ \*Dinheiro\*/);
  assert.match(menu, /5️⃣ \*Pagamento misto\*/);
});

test('changes the total price only while closing a pending sale', async () => {
  const userId = 'pending-price-user';
  const chatId = 'pending-price-chat';
  const replies: string[] = [];
  saveSaleSession({
    userId,
    chatId,
    step: 'awaiting_payment',
    productId: 'pending-price-product',
    reference: '175/70 R13',
    description: 'SPM MH01',
    quantity: 2,
    cashPrice: 600,
    creditPrice: 669.90,
    unitPrice: 669.90,
    totalValue: 1339.80,
    priceType: 'A prazo',
    pendingSaleId: 'pending-price-id',
    wasPending: true,
    updatedAt: Date.now(),
  });
  const message = {
    author: userId,
    from: chatId,
    hasMedia: false,
    type: 'chat',
    rawData: {},
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;

  await handleSaleConversation(message, '7');
  assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_pending_price');
  assert.match(replies.at(-1) ?? '', /ALTERAR PREÇO DA PENDÊNCIA/);
  assert.match(replies.at(-1) ?? '', /R\$1339,80/);

  await handleSaleConversation(message, '1.450,00');
  const changed = getSaleSession(userId, chatId);
  assert.equal(changed?.step, 'awaiting_payment');
  assert.equal(changed?.totalValue, 1450);
  assert.equal(changed?.unitPrice, 725);
  assert.equal(changed?.pendingPreviousTotalValue, 1339.80);
  assert.equal(changed?.pendingPriceChanged, true);
  assert.match(replies.at(-1) ?? '', /R\$1339,80 → \*R\$1450,00\*/);
  assert.match(replies.at(-1) ?? '', /7️⃣ \*Alterar preço\*/);
  assert.match(
    formatRegisteredSale(
      { ...changed!, step: 'awaiting_confirmation', paymentMethod: 'PIX' },
      '#V-2',
      'Fulano',
      2
    ),
    /Preço ajustado: \*R\$1339,80 → R\$1450,00\*/
  );
  clearSaleSession(userId, chatId);
});

test('distributes a changed pending total across multiple items in the confirmation', () => {
  const session: SaleSession = {
    userId: 'multi-price-user',
    chatId: 'multi-price-chat',
    step: 'awaiting_confirmation',
    productId: 'product-two',
    reference: '185/65 R15',
    description: 'PNEU DOIS',
    quantity: 1,
    cashPrice: 200,
    creditPrice: 220,
    unitPrice: 200,
    totalValue: 360,
    paymentMethod: 'PIX',
    pendingSaleId: 'multi-price-pending',
    pendingPriceChanged: true,
    pendingPreviousTotalValue: 300,
    wasPending: true,
    items: [
      {
        productId: 'product-one', reference: '175/70 R13', description: 'PNEU UM',
        quantity: 1, cashPrice: 100, creditPrice: 110, priceType: 'À vista',
        unitPrice: 100, totalValue: 100,
      },
      {
        productId: 'product-two', reference: '185/65 R15', description: 'PNEU DOIS',
        quantity: 1, cashPrice: 200, creditPrice: 220, priceType: 'À vista',
        unitPrice: 200, totalValue: 200,
      },
    ],
    updatedAt: Date.now(),
  };
  const confirmation = formatSaleConfirmation(session);
  assert.match(confirmation, /PNEU UM\*\n📤 \*1 un\.\* \| 💰 \*R\$120,00\*/);
  assert.match(confirmation, /PNEU DOIS\*\n📤 \*1 un\.\* \| 💰 \*R\$240,00\*/);
  assert.match(confirmation, /Preço ajustado: \*R\$300,00 → R\$360,00\*/);
});

test('applies a discount before choosing payment for a pending sale', async () => {
  const userId = 'pending-discount-user';
  const chatId = 'pending-discount-chat';
  const replies: string[] = [];
  saveSaleSession({
    userId,
    chatId,
    step: 'awaiting_payment',
    productId: 'pending-discount-product',
    reference: '175/70 R13',
    description: 'SPM MH01',
    quantity: 1,
    cashPrice: 300,
    creditPrice: 320,
    unitPrice: 300,
    totalValue: 300,
    priceType: 'À vista',
    pendingSaleId: 'pending-discount-id',
    updatedAt: Date.now(),
  });
  const message = {
    author: userId,
    from: chatId,
    hasMedia: false,
    type: 'chat',
    rawData: {},
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;

  await handleSaleConversation(message, '6');
  assert.equal(getSaleSession(userId, chatId)?.step, 'awaiting_discount_type');

  await handleSaleConversation(message, '2');
  await handleSaleConversation(message, '50');
  await handleSaleConversation(message, '1');

  const discounted = getSaleSession(userId, chatId);
  assert.equal(discounted?.step, 'awaiting_payment');
  assert.equal(discounted?.pendingSaleId, 'pending-discount-id');
  assert.equal(discounted?.originalTotalValue, 300);
  assert.equal(discounted?.discountAmount, 50);
  assert.equal(discounted?.totalValue, 250);
  assert.match(replies.at(-1) ?? '', /6️⃣ \*Desconto\* ✅/);
  clearSaleSession(userId, chatId);
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
