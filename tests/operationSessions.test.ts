import assert from 'node:assert/strict';
import test from 'node:test';
import { saveSaleSession } from '../src/utils/saleSessionStore.js';
import { savePriceSession } from '../src/utils/priceSessionStore.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
} from '../src/utils/operationSessionCoordinator.js';
import { clearLastQuery, getLastQuery, saveLastQuery } from '../src/utils/lastQueryStore.js';

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
  assert.equal(hasActiveOperationSession(userId, chatId), true);
  clearAllOperationSessions(userId, chatId);
  assert.equal(hasActiveOperationSession(userId, chatId), false);
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
