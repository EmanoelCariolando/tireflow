import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPLOYEE_SESSION_TTL_MS } from '../src/utils/employeeSessionDuration.js';
import {
  getProductNameSession, saveProductNameSession,
} from '../src/utils/productNameSessionStore.js';
import {
  clearAllOperationSessions, clearExpiredOperationSessions, hasActiveOperationSession, isOperationStartCommand,
} from '../src/utils/operationSessionCoordinator.js';

test('isolates name sessions by user and chat and includes them in cancellation and expiry', () => {
  const originalNow = Date.now;
  let now = 100_000;
  try {
    Date.now = () => now;
    const session = {
      userId: 'name-user', chatId: 'name-chat', productId: 'product', reference: '175/70 R14',
      previousDescription: 'PNEU TESTE', step: 'awaiting_name' as const, updatedAt: now,
    };
    saveProductNameSession(session);
    assert.equal(isOperationStartCommand('NOME 1'), true);
    assert.equal(hasActiveOperationSession(session.userId, session.chatId), true);
    assert.equal(getProductNameSession('other-user', session.chatId), null);
    assert.equal(getProductNameSession(session.userId, 'other-chat'), null);
    clearAllOperationSessions(session.userId, session.chatId);
    assert.equal(hasActiveOperationSession(session.userId, session.chatId), false);
    saveProductNameSession(session);
    now += EMPLOYEE_SESSION_TTL_MS + 1;
    assert.equal(clearExpiredOperationSessions(session.userId, session.chatId), true);
    assert.equal(getProductNameSession(session.userId, session.chatId), null);
  } finally {
    Date.now = originalNow;
    clearAllOperationSessions('name-user', 'name-chat');
  }
});
