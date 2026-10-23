import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { parseNonNegativeInteger, parseProductRegistrationPrice } from '../src/commands/productRegistrationParsers.js';
import { parseEntryPriceValue, parseAdditionalEntryItemSelection } from '../src/utils/entrySessionHelpers.js';
import { parseAdditionalItemSelection } from '../src/commands/saleParsers.js';
import { handleAdjustmentConversation } from '../src/commands/adjustmentCommand.js';
import { getAdjustmentSession, saveAdjustmentSession, clearAdjustmentSession } from '../src/utils/adjustmentSessionStore.js';
import { handleEntryConversation } from '../src/commands/entryCommand.js';
import { getEntrySession, saveEntrySession, clearEntrySession } from '../src/utils/entrySessionStore.js';
import { parseCurrencyToCents } from '../src/utils/salePayment.js';
import { handleProductActionConversation, type ProductActionDependencies } from '../src/commands/productActionCommand.js';
import { saveLastQuery, clearLastQuery } from '../src/utils/lastQueryStore.js';
import { saveProductActionSession, clearProductActionSession } from '../src/utils/productActionSessionStore.js';

const userId = 'numeric-input-user';
const chatId = 'numeric-input-chat@g.us';
const message = { author: userId, from: chatId, reply: async () => {} } as unknown as Message;
const invalidIntegers = ['', '   ', '1.000', '1.000,50', '1000,50', '1000.50', '0,00',
  'abc', '-1', '-0', '+1', '1e3', '0x10', '2147483648', '9007199254740993', '9'.repeat(310)];

test('stock reader accepts plain nonnegative Int values and rejects unsupported representations', () => {
  assert.equal(parseNonNegativeInteger('0'), 0);
  assert.equal(parseNonNegativeInteger('1000'), 1000);
  assert.equal(parseNonNegativeInteger(' 1000 '), 1000);
  assert.equal(parseNonNegativeInteger('2147483647'), 2147483647);
  for (const input of invalidIntegers) assert.equal(parseNonNegativeInteger(input), null, JSON.stringify(input));
});

test('additional product selection refuses unsafe indices and quantities', () => {
  assert.equal(parseAdditionalEntryItemSelection('9007199254740993'), null);
  assert.equal(parseAdditionalItemSelection('1 9007199254740993'), null);
});

for (const [input, amount, cents] of [
  ['1000', 1000, 100000], ['1.000,50', 1000.5, 100050],
  ['1000,50', 1000.5, 100050], ['1000.50', 1000.5, 100050],
  ['1.000', 1000, 100000], ['1,000', 1000, 100000], ['1,299.90', 1299.9, 129990],
  ['12,345', 12345, 1234500], ['100,999', 100999, 10099900],
  ['1.234.567,89', 1234567.89, 123456789], ['1,234,567.89', 1234567.89, 123456789],
  ['R$ 1,299.90', 1299.9, 129990], ['0', 0, 0], ['0,00', 0, 0], ['0.00', 0, 0],
] as const) {
  test(`unambiguous monetary input keeps the same amount: ${input}`, () => {
    assert.equal(parseEntryPriceValue(input), amount);
    assert.equal(parseProductRegistrationPrice(input), amount);
    assert.equal(parseCurrencyToCents(input), cents);
  });
}

test('numeric product menu validates quantity without bypassing the shared integer limits', async () => {
  const calls: string[] = [];
  const action = async (_message: Message, body: string) => { calls.push(body); return true; };
  const dependencies: ProductActionDependencies = { sale: action, entry: action, price: action, photo: action,
    adjustment: action, addPhoto: action, location: action, rename: action, inventoryLocationsEnabled: false };
  try {
    saveLastQuery(userId, chatId, '175/70 R14', [{ id: 'p', reference: '175/70 R14',
      description: 'PNEU', stock: 10, cashPrice: 100, creditPrice: 105.8 }]);
    saveProductActionSession(userId, chatId, 'awaiting_sale_quantity', 1);
    for (const input of ['2147483648', '1e3', '0x10', '+1', '1.0']) {
      await handleProductActionConversation(message, input, dependencies);
      assert.deepEqual(calls, []);
    }
    await handleProductActionConversation(message, '2', dependencies);
    assert.deepEqual(calls, ['venda 1 2']);
  } finally { clearLastQuery(userId, chatId); clearProductActionSession(userId, chatId); }
});

for (const input of ['80000000000000.01', '90071992547409.91']) {
  for (const [domain, reader] of [
    ['entry price', parseEntryPriceValue], ['registration price', parseProductRegistrationPrice],
    ['payment cents', parseCurrencyToCents],
  ] as const) {
    test(`${domain} refuses a value whose cents cannot round-trip: ${input}`, () => {
      assert.equal(reader(input), null);
    });
  }
}

for (const [input, price] of [
  ['1000.123', 1000.12], ['1,2345', 1.23], ['1.0050', 1.01], ['2.6750', 2.68],
  ['1.234,567', 1234.57], ['1,234.567', 1234.57],
  ['2.674999999999999999999999999', 2.67],
] as const) {
  test(`prices round the exact decimal, while payment amounts require cents: ${input}`, () => {
    assert.equal(parseEntryPriceValue(input), price);
    assert.equal(parseProductRegistrationPrice(input), price);
    assert.equal(parseCurrencyToCents(input), null);
  });
}

for (const input of ['1,2,3', '12.34,56', '12,34.56', '1.234,56.7', '1,234.56,7', '1..000', '1000,']) {
  test(`malformed grouping cannot change a monetary amount: ${input}`, () => {
    assert.equal(parseEntryPriceValue(input), null);
    assert.equal(parseProductRegistrationPrice(input), null);
    assert.equal(parseCurrencyToCents(input), null);
  });
}

for (const input of ['', '  ', '0x10', '1e3', '-0', '9007199254740993', '9'.repeat(310)]) {
  test(`entry and registration prices reject missing, nondecimal or unsafe input ${JSON.stringify(input)}`, () => {
    assert.equal(parseEntryPriceValue(input), null);
    assert.equal(parseProductRegistrationPrice(input), null);
  });
}

for (const input of invalidIntegers) {
  test(`counting stock cannot turn invalid input into a balance: ${JSON.stringify(input)}`, async () => {
    try {
      saveAdjustmentSession({ userId, chatId, step: 'awaiting_new_stock', productId: 'p',
        reference: '175/70 R14', description: 'PNEU', previousStock: 5, updatedAt: Date.now() });
      await handleAdjustmentConversation(message, input);
      assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_new_stock');
      assert.equal(getAdjustmentSession(userId, chatId)?.newStock, undefined);
    } finally { clearAdjustmentSession(userId, chatId); }
  });
  test(`entry cannot interpret non-integer notation as a quantity: ${JSON.stringify(input)}`, async () => {
    try {
      saveEntrySession({ userId, chatId, step: 'awaiting_quantity', productId: 'p',
        reference: '175/70 R14', description: 'PNEU', oldCashPrice: 100, oldCreditPrice: 105.8, updatedAt: Date.now() });
      await handleEntryConversation(message, input);
      assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_quantity');
      assert.equal(getEntrySession(userId, chatId)?.quantity, undefined);
    } finally { clearEntrySession(userId, chatId); }
  });
}

test('stock addition refuses an overflowing resulting balance', async () => {
  try {
    saveAdjustmentSession({ userId, chatId, step: 'awaiting_quantity', kind: 'add', productId: 'p',
      reference: '175/70 R14', description: 'PNEU', previousStock: 2147483647, updatedAt: Date.now() });
    await handleAdjustmentConversation(message, '1');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_quantity');
    assert.equal(getAdjustmentSession(userId, chatId)?.newStock, undefined);
  } finally { clearAdjustmentSession(userId, chatId); }
});
