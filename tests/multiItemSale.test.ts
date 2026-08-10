import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  formatBossSaleNotification,
  formatSaleConfirmation,
  handleSaleConversation,
} from '../src/commands/saleCommand.js';
import {
  allocateAmountByWeights,
  allocatePaymentBreakdownAcrossTotals,
} from '../src/utils/saleAllocation.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
  type SaleSession,
} from '../src/utils/saleSessionStore.js';

const multiItemSession: SaleSession = {
  userId: 'multi-sale-user',
  chatId: 'multi-sale-chat',
  step: 'awaiting_confirmation',
  productId: 'product-two',
  reference: '275/80 R22.5',
  description: 'PNEU PESADO',
  quantity: 1,
  cashPrice: 2000,
  creditPrice: 2100,
  unitPrice: 2000,
  totalValue: 2279.50,
  originalTotalValue: 2350,
  discountPercent: 3,
  paymentMethod: 'PIX',
  items: [
    {
      productId: 'product-one', reference: '175/70 R13', description: 'PNEU PASSEIO',
      quantity: 1, cashPrice: 350, creditPrice: 380, priceType: 'À vista',
      unitPrice: 350, totalValue: 350,
    },
    {
      productId: 'product-two', reference: '275/80 R22.5', description: 'PNEU PESADO',
      quantity: 1, cashPrice: 2000, creditPrice: 2100, priceType: 'À vista',
      unitPrice: 2000, totalValue: 2000,
    },
  ],
  updatedAt: Date.now(),
};

test('allocates discounts and mixed payments without losing a cent', () => {
  assert.deepEqual(allocateAmountByWeights(227_950, [35_000, 200_000]), [33_950, 194_000]);
  assert.deepEqual(
    allocatePaymentBreakdownAcrossTotals(
      [
        { method: 'PIX', amount: 1000 },
        { method: 'Dinheiro', amount: 1279.50 },
      ],
      [33_950, 194_000]
    ),
    [
      [{ method: 'PIX', amount: 339.50 }],
      [
        { method: 'PIX', amount: 660.50 },
        { method: 'Dinheiro', amount: 1279.50 },
      ],
    ]
  );
});

test('shows every tire under one confirmation and one total', () => {
  const confirmation = formatSaleConfirmation(multiItemSession);
  assert.match(confirmation, /CONFIRMAR VENDA/);
  assert.match(confirmation, /175\/70 R13/);
  assert.match(confirmation, /275\/80 R22\.5/);
  assert.match(confirmation, /Desconto: \*3% \(-R\$70,50\)\*/);
  assert.match(confirmation, /Total: \*R\$2279,50\*/);

  const notification = formatBossSaleNotification(
    multiItemSession,
    '#V-000010',
    'Vendedor',
    4,
    [
      { productId: 'product-one', movementCode: '#V-000010', previousStock: 5, currentStock: 4 },
      { productId: 'product-two', movementCode: '#V-000011', previousStock: 2, currentStock: 1 },
    ]
  );
  assert.match(notification, /Compra: #V-000010/);
  assert.match(notification, /Movimentações: #V-000010, #V-000011/);
});

test('option 7 keeps the current purchase and asks directly for another measure', async () => {
  const session = { ...multiItemSession, step: 'awaiting_payment' as const };
  saveSaleSession(session);
  const replies: string[] = [];
  const message = {
    author: session.userId,
    from: session.chatId,
    hasMedia: false,
    type: 'chat',
    rawData: {},
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;

  await handleSaleConversation(message, '7');
  assert.equal(getSaleSession(session.userId, session.chatId)?.step, 'awaiting_additional_measure');
  assert.match(replies.at(-1) ?? '', /Digite a medida/);
  assert.match(replies.at(-1) ?? '', /Total atual: \*R\$2279,50\*/);
  clearSaleSession(session.userId, session.chatId);
});

test('applies the discount when cart items use different price types', async () => {
  const ids = { userId: 'mixed-price-user', chatId: 'mixed-price-chat' };
  const session: SaleSession = {
    ...multiItemSession,
    ...ids,
    step: 'awaiting_payment',
    priceType: undefined,
    discountPercent: undefined,
    originalTotalValue: undefined,
    totalValue: 2450,
    items: [
      multiItemSession.items![0]!,
      {
        ...multiItemSession.items![1]!,
        priceType: 'A prazo',
        unitPrice: 2100,
        totalValue: 2100,
      },
    ],
  };
  saveSaleSession(session);
  const replies: string[] = [];
  const message = {
    author: ids.userId,
    from: ids.chatId,
    hasMedia: false,
    type: 'chat',
    rawData: {},
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;

  await handleSaleConversation(message, '6');
  const discounted = getSaleSession(ids.userId, ids.chatId);
  assert.equal(discounted?.step, 'awaiting_discount_confirmation');
  assert.equal(discounted?.originalTotalValue, 2450);
  assert.equal(discounted?.totalValue, 2376.50);
  assert.match(replies.at(-1) ?? '', /Subtotal: \*R\$2450,00\*/);
  clearSaleSession(ids.userId, ids.chatId);
});
