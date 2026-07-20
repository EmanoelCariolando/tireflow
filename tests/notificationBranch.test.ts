import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPrivateOwnerNotification } from '../src/services/notificationService.js';

test('adds the configured branch header to a private owner notification', () => {
  assert.equal(
    formatPrivateOwnerNotification('✅ NOVA VENDA', 'ATC PNEUS CONGO'),
    '🏢 ATC PNEUS CONGO\n\n✅ NOVA VENDA'
  );
});

test('uses ATC PNEUS when the configured branch is empty', () => {
  assert.equal(
    formatPrivateOwnerNotification('Relatório de hoje', '   '),
    '🏢 ATC PNEUS\n\nRelatório de hoje'
  );
});

test('does not duplicate an existing branch header', () => {
  const notification = '🏢 ATC PNEUS MONTEIRO\n\n⚠️ ESTOQUE BAIXO';

  assert.equal(
    formatPrivateOwnerNotification(notification, 'ATC PNEUS MONTEIRO'),
    notification
  );
});
