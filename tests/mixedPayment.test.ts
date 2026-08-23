import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  handleSaleConversation,
  isCashReceiptRequired,
} from '../src/commands/saleCommand.js';
import env from '../src/config/env.js';
import { calculatePaymentTotals } from '../src/services/reportService.js';
import {
  buildPaymentBreakdown,
  parseCurrencyToCents,
  parseMixedPaymentMethods,
  serializePaymentBreakdown,
} from '../src/utils/salePayment.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
} from '../src/utils/saleSessionStore.js';

const userId = 'mixed-payment-user';
const chatId = 'mixed-payment-group@g.us';

function startSale(suffix: string): { userId: string; chatId: string } {
  const ids = {
    userId: `${userId}-${suffix}`,
    chatId: `${chatId}-${suffix}`,
  };
  saveSaleSession({
    ...ids,
    step: 'awaiting_payment',
    productId: `product-${suffix}`,
    reference: '205/70 R15',
    description: 'VAN SEMPERITE CONTINENTAL 96',
    quantity: 2,
    cashPrice: 250,
    creditPrice: 275,
    priceType: 'À vista',
    unitPrice: 250,
    totalValue: 500,
    updatedAt: Date.now(),
  });
  return ids;
}

function createMessage(
  ids: { userId: string; chatId: string },
  replies: string[],
  imageId?: string
): Message {
  const message = {
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
  };
  return message as unknown as Message;
}

async function runInBranch(branchName: string, operation: () => Promise<void>): Promise<void> {
  const previousBranchName = env.branchName;
  env.branchName = branchName;
  try {
    await operation();
  } finally {
    env.branchName = previousBranchName;
  }
}

test('requires a cash receipt only in Monteiro', () => {
  assert.equal(isCashReceiptRequired('ATC PNEUS MONTEIRO'), true);
  assert.equal(isCashReceiptRequired('ATC PNEUS CONGO'), false);
});

test('accepts exactly two supported and distinct mixed payment methods', () => {
  assert.deepEqual(parseMixedPaymentMethods('1 e 2'), ['Dinheiro', 'PIX']);
  assert.deepEqual(parseMixedPaymentMethods('PIX + cartão'), ['PIX', 'Cartão']);
  assert.deepEqual(parseMixedPaymentMethods('3/1'), ['Cartão', 'Dinheiro']);

  assert.equal(parseMixedPaymentMethods('1 2 3'), null);
  assert.equal(parseMixedPaymentMethods('1 e 1'), null);
  assert.equal(parseMixedPaymentMethods('1 e 4'), null);
  assert.equal(parseMixedPaymentMethods('1'), null);
  assert.equal(parseMixedPaymentMethods('qualquer coisa'), null);
});

test('parses Brazilian currency without allowing ambiguous or malformed cents', () => {
  assert.equal(parseCurrencyToCents('300,00'), 30_000);
  assert.equal(parseCurrencyToCents('R$ 1.234,56'), 123_456);
  assert.equal(parseCurrencyToCents('300.50'), 30_050);
  assert.equal(parseCurrencyToCents('1.000'), 100_000);
  assert.equal(parseCurrencyToCents('100'), 10_000);

  assert.equal(parseCurrencyToCents('100,999'), null);
  assert.equal(parseCurrencyToCents('-10'), null);
  assert.equal(parseCurrencyToCents('R$ cem'), null);
});

test('builds an exact two-part split and rejects zero, total or excess values', () => {
  assert.deepEqual(
    buildPaymentBreakdown(['Dinheiro', 'PIX'], 'PIX', 30_000, 50_000),
    [
      { method: 'PIX', amount: 300 },
      { method: 'Dinheiro', amount: 200 },
    ]
  );
  assert.equal(buildPaymentBreakdown(['Dinheiro', 'PIX'], 'PIX', 0, 50_000), null);
  assert.equal(buildPaymentBreakdown(['Dinheiro', 'PIX'], 'PIX', 50_000, 50_000), null);
  assert.equal(buildPaymentBreakdown(['Dinheiro', 'PIX'], 'PIX', 60_000, 50_000), null);
});

test('requires PIX and cash receipts for Dinheiro + PIX in Monteiro', async () => {
  await runInBranch('ATC PNEUS MONTEIRO', async () => {
  const ids = startSale('cash-pix');
  const replies: string[] = [];

  await handleSaleConversation(createMessage(ids, replies), '5');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_mixed_methods');

  await handleSaleConversation(createMessage(ids, replies), '1 2 3');
  assert.match(replies.at(-1) ?? '', /Ex\.: \*1 e 2\*/);
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_mixed_methods');

  await handleSaleConversation(createMessage(ids, replies), '1 e 2');
  const amountSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(amountSession?.step, 'awaiting_mixed_amount');
  assert.equal(amountSession?.totalValue, 500);
  assert.equal(amountSession?.mixedAmountMethod, 'PIX');
  assert.match(replies.at(-1) ?? '', /Quanto foi pago em \*PIX\*/);

  for (const invalidAmount of ['0', '500,00', '600,00', 'valor']) {
    await handleSaleConversation(createMessage(ids, replies), invalidAmount);
    assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_mixed_amount');
    assert.match(replies.at(-1) ?? '', /Ex\.: \*100,00\*/);
  }

  await handleSaleConversation(createMessage(ids, replies), '300,00');
  const receiptSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(receiptSession?.step, 'awaiting_photo');
  assert.deepEqual(receiptSession?.pendingReceiptMethods, ['PIX', 'Dinheiro']);
  assert.deepEqual(receiptSession?.paymentBreakdown, [
    { method: 'PIX', amount: 300 },
    { method: 'Dinheiro', amount: 200 },
  ]);
  assert.match(replies.at(-1) ?? '', /COMPROVANTE — PIX/);

  await handleSaleConversation(createMessage(ids, replies, 'pix-receipt'), '');
  assert.deepEqual(
    getSaleSession(ids.userId, ids.chatId)?.pendingReceiptMethods,
    ['Dinheiro']
  );
  assert.match(replies.at(-1) ?? '', /depósito\/dinheiro/);

  await handleSaleConversation(createMessage(ids, replies, 'cash-receipt'), '');
  const confirmationSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(confirmationSession?.step, 'awaiting_confirmation');
  assert.equal(confirmationSession?.receipts?.length, 2);
  assert.match(
    replies.at(-1) ?? '',
    /Pagamento: \*Misto\* \| Valor: \*À vista\*\n\*PIX\*: \*R\$300,00\* \| \*Dinheiro\*: \*R\$200,00\*/
  );

  clearSaleSession(ids.userId, ids.chatId);
  });
});

test('skips only the cash receipt in a mixed payment outside Monteiro', async () => {
  await runInBranch('ATC PNEUS CONGO', async () => {
    const ids = startSale('congo-cash-pix');
    const replies: string[] = [];

    await handleSaleConversation(createMessage(ids, replies), '5');
    await handleSaleConversation(createMessage(ids, replies), '1 e 2');
    await handleSaleConversation(createMessage(ids, replies), '300,00');

    assert.deepEqual(
      getSaleSession(ids.userId, ids.chatId)?.pendingReceiptMethods,
      ['PIX']
    );
    assert.match(replies.at(-1) ?? '', /COMPROVANTE — PIX/);

    await handleSaleConversation(createMessage(ids, replies, 'congo-pix-receipt'), '');
    const confirmationSession = getSaleSession(ids.userId, ids.chatId);
    assert.equal(confirmationSession?.step, 'awaiting_confirmation');
    assert.equal(confirmationSession?.receipts?.length, 1);
    assert.doesNotMatch(replies.at(-1) ?? '', /depósito\/dinheiro/);
    assert.match(replies.at(-1) ?? '', /VENDA — CONFIRMAR/);

    clearSaleSession(ids.userId, ids.chatId);
  });
});

test('requires PIX and card receipts in sequence for PIX + Cartão', async () => {
  const ids = startSale('pix-card');
  const replies: string[] = [];

  await handleSaleConversation(createMessage(ids, replies), '5');
  await handleSaleConversation(createMessage(ids, replies), '2 e 3');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_mixed_amount');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.totalValue, 500);

  await handleSaleConversation(createMessage(ids, replies), '200');
  assert.deepEqual(
    getSaleSession(ids.userId, ids.chatId)?.pendingReceiptMethods,
    ['PIX', 'Cartão']
  );

  await handleSaleConversation(createMessage(ids, replies, 'pix-card-pix'), '');
  assert.deepEqual(
    getSaleSession(ids.userId, ids.chatId)?.pendingReceiptMethods,
    ['Cartão']
  );
  assert.match(replies.at(-1) ?? '', /COMPROVANTE — CARTÃO/);

  await handleSaleConversation(createMessage(ids, replies, 'pix-card-card'), '');
  const confirmationSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(confirmationSession?.step, 'awaiting_confirmation');
  assert.equal(confirmationSession?.receipts?.length, 2);
  assert.match(
    replies.at(-1) ?? '',
    /\*PIX\*: \*R\$200,00\* \| \*Cartão\*: \*R\$300,00\*/
  );

  clearSaleSession(ids.userId, ids.chatId);
});

test('requires card and cash receipts for Dinheiro + Cartão in Monteiro', async () => {
  await runInBranch('ATC PNEUS MONTEIRO', async () => {
  const ids = startSale('cash-card');
  const replies: string[] = [];

  await handleSaleConversation(createMessage(ids, replies), '5');
  await handleSaleConversation(createMessage(ids, replies), '1 e 3');
  await handleSaleConversation(createMessage(ids, replies), '150,00');

  const receiptSession = getSaleSession(ids.userId, ids.chatId);
  assert.equal(receiptSession?.totalValue, 500);
  assert.deepEqual(receiptSession?.paymentBreakdown, [
    { method: 'Cartão', amount: 150 },
    { method: 'Dinheiro', amount: 350 },
  ]);
  assert.deepEqual(receiptSession?.pendingReceiptMethods, ['Cartão', 'Dinheiro']);
  assert.match(replies.at(-1) ?? '', /COMPROVANTE — CARTÃO/);

  await handleSaleConversation(createMessage(ids, replies, 'cash-card-card'), '');
  assert.deepEqual(
    getSaleSession(ids.userId, ids.chatId)?.pendingReceiptMethods,
    ['Dinheiro']
  );
  assert.match(replies.at(-1) ?? '', /depósito\/dinheiro/);

  await handleSaleConversation(createMessage(ids, replies, 'cash-card-cash'), '');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.step, 'awaiting_confirmation');
  assert.equal(getSaleSession(ids.userId, ids.chatId)?.receipts?.length, 2);

  clearSaleSession(ids.userId, ids.chatId);
  });
});

test('attributes persisted mixed amounts to each method in the daily report', () => {
  const paymentDetails = serializePaymentBreakdown([
    { method: 'PIX', amount: 300 },
    { method: 'Dinheiro', amount: 200 },
  ]);
  const totals = calculatePaymentTotals([
    {
      paymentMethod: 'Misto',
      paymentDetails: paymentDetails ?? null,
      totalValue: 500,
    },
    {
      paymentMethod: 'Cartão',
      paymentDetails: null,
      totalValue: 250,
    },
  ]);

  assert.deepEqual(totals, {
    Dinheiro: 200,
    PIX: 300,
    Cartão: 250,
    Nota: 0,
  });
});
