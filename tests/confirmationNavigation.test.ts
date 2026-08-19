import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { handleAdjustmentConversation } from '../src/commands/adjustmentCommand.js';
import { handleEntryConversation } from '../src/commands/entryCommand.js';
import { handlePriceConversation } from '../src/commands/priceCommand.js';
import { handleProductRegistrationConversation } from '../src/commands/productRegistrationCommand.js';
import { handleSaleConversation } from '../src/commands/saleCommand.js';
import env from '../src/config/env.js';
import {
  clearAdjustmentSession,
  getAdjustmentSession,
  saveAdjustmentSession,
} from '../src/utils/adjustmentSessionStore.js';
import {
  clearEntrySession,
  getEntrySession,
  saveEntrySession,
} from '../src/utils/entrySessionStore.js';
import {
  clearPriceSession,
  getPriceSession,
  savePriceSession,
} from '../src/utils/priceSessionStore.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
  saveProductRegistrationSession,
} from '../src/utils/productRegistrationSessionStore.js';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
} from '../src/utils/saleSessionStore.js';

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

test('keeps zero as a valid stock outside a confirmation screen', async () => {
  const userId = 'confirmation-adjustment-zero-user';
  const chatId = 'confirmation-adjustment-zero-group@g.us';
  const replies: string[] = [];

  try {
    saveAdjustmentSession({
      userId,
      chatId,
      step: 'awaiting_new_stock',
      productId: 'adjustment-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      previousStock: 4,
      updatedAt: Date.now(),
    });

    await handleAdjustmentConversation(createMessage(userId, chatId, replies), '0');

    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_reason');
    assert.equal(getAdjustmentSession(userId, chatId)?.newStock, 0);
  } finally {
    clearAdjustmentSession(userId, chatId);
  }
});

test('option 2 returns one safe step in every final confirmation', async () => {
  const previousLocationsFlag = env.inventoryLocationsEnabled;
  env.inventoryLocationsEnabled = false;

  const cases = {
    adjustment: ['confirmation-adjustment-user', 'confirmation-adjustment-group@g.us'],
    entry: ['confirmation-entry-user', 'confirmation-entry-group@g.us'],
    price: ['confirmation-price-user', 'confirmation-price-group@g.us'],
    registration: ['confirmation-registration-user', 'confirmation-registration-group@g.us'],
    sale: ['confirmation-sale-user', 'confirmation-sale-group@g.us'],
  } as const;

  try {
    const adjustmentReplies: string[] = [];
    saveAdjustmentSession({
      userId: cases.adjustment[0],
      chatId: cases.adjustment[1],
      step: 'awaiting_confirmation',
      productId: 'adjustment-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      previousStock: 4,
      newStock: 3,
      reason: 'Conferência',
      updatedAt: Date.now(),
    });
    await handleAdjustmentConversation(
      createMessage(...cases.adjustment, adjustmentReplies),
      '2'
    );
    assert.equal(getAdjustmentSession(...cases.adjustment)?.step, 'awaiting_reason');
    assert.match(adjustmentReplies.at(-1) ?? '', /AJUSTE — MOTIVO/);

    const entryReplies: string[] = [];
    saveEntrySession({
      userId: cases.entry[0],
      chatId: cases.entry[1],
      step: 'awaiting_confirmation',
      productId: 'entry-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      oldCashPrice: 300,
      oldCreditPrice: 320,
      items: [{
        productId: 'entry-product',
        reference: '175/70 R14',
        description: 'PNEU TESTE',
        oldCashPrice: 300,
        oldCreditPrice: 320,
        quantity: 2,
        supplier: 'Fornecedor',
      }],
      updatedAt: Date.now(),
    });
    await handleEntryConversation(createMessage(...cases.entry, entryReplies), '2');
    assert.equal(getEntrySession(...cases.entry)?.step, 'awaiting_additional_decision');
    assert.match(entryReplies.at(-1) ?? '', /ADICIONAR MAIS ALGUM PNEU/);

    const priceReplies: string[] = [];
    savePriceSession({
      userId: cases.price[0],
      chatId: cases.price[1],
      step: 'awaiting_confirmation',
      productId: 'price-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      stock: 4,
      oldCashPrice: 300,
      oldCreditPrice: 320,
      newCashPrice: 350,
      newCreditPrice: 370.3,
      updatedAt: Date.now(),
    });
    await handlePriceConversation(createMessage(...cases.price, priceReplies), '2');
    assert.equal(getPriceSession(...cases.price)?.step, 'awaiting_cash_price');
    assert.match(priceReplies.at(-1) ?? '', /PREÇO À VISTA/);

    const registrationReplies: string[] = [];
    saveProductRegistrationSession({
      userId: cases.registration[0],
      chatId: cases.registration[1],
      step: 'awaiting_confirmation',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      initialStock: 0,
      cashPrice: 300,
      creditPrice: 317.4,
      stockLocation: null,
      updatedAt: Date.now(),
    });
    await handleProductRegistrationConversation(
      createMessage(...cases.registration, registrationReplies),
      '2'
    );
    assert.equal(
      getProductRegistrationSession(...cases.registration)?.step,
      'awaiting_cash_price'
    );
    assert.match(registrationReplies.at(-1) ?? '', /PREÇO À VISTA/);

    const saleReplies: string[] = [];
    saveSaleSession({
      userId: cases.sale[0],
      chatId: cases.sale[1],
      step: 'awaiting_confirmation',
      productId: 'sale-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      quantity: 2,
      cashPrice: 300,
      creditPrice: 320,
      priceType: 'À vista',
      unitPrice: 300,
      totalValue: 600,
      paymentMethod: 'PIX',
      updatedAt: Date.now(),
    });
    await handleSaleConversation(createMessage(...cases.sale, saleReplies), '2');
    assert.equal(getSaleSession(...cases.sale)?.step, 'awaiting_payment');
    assert.equal(getSaleSession(...cases.sale)?.paymentMethod, undefined);
    assert.match(saleReplies.at(-1) ?? '', /FORMAS DE PAGAMENTO/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearAdjustmentSession(...cases.adjustment);
    clearEntrySession(...cases.entry);
    clearPriceSession(...cases.price);
    clearProductRegistrationSession(...cases.registration);
    clearSaleSession(...cases.sale);
  }
});

test('option 0 cancels only from a confirmation screen', async () => {
  const userId = 'confirmation-cancel-user';
  const chatId = 'confirmation-cancel-group@g.us';
  const replies: string[] = [];

  try {
    savePriceSession({
      userId,
      chatId,
      step: 'awaiting_confirmation',
      productId: 'price-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      stock: 4,
      oldCashPrice: 300,
      oldCreditPrice: 320,
      newCashPrice: 350,
      newCreditPrice: 370.3,
      updatedAt: Date.now(),
    });

    await handlePriceConversation(createMessage(userId, chatId, replies), '0');

    assert.equal(getPriceSession(userId, chatId), null);
    assert.equal(replies.at(-1), '❌ *OPERAÇÃO CANCELADA*');
  } finally {
    clearPriceSession(userId, chatId);
  }
});
