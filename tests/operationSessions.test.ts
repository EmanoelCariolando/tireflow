import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSaleSession,
  getSaleSession,
  saveSaleSession,
} from '../src/utils/saleSessionStore.js';
import { savePriceSession } from '../src/utils/priceSessionStore.js';
import { saveLocationSession } from '../src/utils/locationSessionStore.js';
import {
  getProductRegistrationSession,
  saveProductRegistrationSession,
} from '../src/utils/productRegistrationSessionStore.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
  isOperationStartCommand,
} from '../src/utils/operationSessionCoordinator.js';
import { clearLastQuery, getLastQuery, saveLastQuery } from '../src/utils/lastQueryStore.js';
import { EMPLOYEE_SESSION_TTL_MS } from '../src/utils/employeeSessionDuration.js';

test('expires an unanswered employee session after twelve minutes', () => {
  const userId = 'session-timeout-user';
  const chatId = 'session-timeout-group@g.us';
  const originalNow = Date.now;
  let now = 1_000_000;

  try {
    Date.now = () => now;
    saveSaleSession({
      userId,
      chatId,
      step: 'awaiting_payment',
      productId: 'timeout-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      quantity: 1,
      cashPrice: 100,
      creditPrice: 105.8,
      updatedAt: now,
    });

    now += EMPLOYEE_SESSION_TTL_MS;
    assert.ok(getSaleSession(userId, chatId));

    now += 1;
    assert.equal(getSaleSession(userId, chatId), null);
  } finally {
    Date.now = originalNow;
    clearSaleSession(userId, chatId);
  }
});

test('clears every incompatible operation for the same user and group', () => {
  const userId = 'session-user';
  const chatId = 'session-group@g.us';
  saveSaleSession({
    userId, chatId, step: 'awaiting_payment', productId: 'p1', reference: '175/70/14',
    description: 'Pneu 1', quantity: 1, cashPrice: 100, creditPrice: 110, updatedAt: Date.now(),
  });
  savePriceSession({
    userId, chatId, step: 'awaiting_cash_price', productId: 'p1', reference: '175/70/14',
    description: 'Pneu 1', stock: 5, oldCashPrice: 100, oldCreditPrice: 110, updatedAt: Date.now(),
  });
  saveLocationSession({
    userId, chatId, step: 'awaiting_location', productId: 'p1', reference: '175/70/14',
    description: 'Pneu 1', previousLocation: null, updatedAt: Date.now(),
  });
  saveProductRegistrationSession({
    userId, chatId, step: 'awaiting_measure', updatedAt: Date.now(),
  });
  assert.equal(hasActiveOperationSession(userId, chatId), true);
  clearAllOperationSessions(userId, chatId);
  assert.equal(hasActiveOperationSession(userId, chatId), false);
  assert.equal(getProductRegistrationSession(userId, chatId), null);
});

test('keeps the last query isolated by both user and chat', () => {
  const product = [{
    id: 'p1', reference: '175/70/14', description: 'Pneu 1', stock: 5,
    cashPrice: 100, creditPrice: 110,
  }];
  saveLastQuery('same-user', 'group-a@g.us', '175/70/14', product);
  assert.ok(getLastQuery('same-user', 'group-a@g.us'));
  assert.equal(getLastQuery('same-user', 'group-b@g.us'), null);
  clearLastQuery('same-user');
});

test('recognizes both accented and unaccented price operation commands', () => {
  assert.equal(isOperationStartCommand('preco 1'), true);
  assert.equal(isOperationStartCommand('preço 1'), true);
});
