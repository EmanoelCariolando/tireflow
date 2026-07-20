import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import { isAuthorizedChat } from '../src/whatsapp/messageHandler.js';
import { formatHealthStatus } from '../src/services/healthService.js';

test('allows only the configured group when private test mode is disabled', () => {
  const previousGroup = env.whatsappOfficialGroupId;
  const previousPrivateMode = env.allowPrivateTestMode;
  env.whatsappOfficialGroupId = '120363111111111111@g.us';
  env.allowPrivateTestMode = false;
  try {
    assert.equal(
      isAuthorizedChat({ from: '120363111111111111@g.us' } as Message),
      true
    );
    assert.equal(
      isAuthorizedChat({ from: '120363222222222222@g.us' } as Message),
      false
    );
    assert.equal(isAuthorizedChat({ from: '5583999999999@c.us' } as Message), false);
  } finally {
    env.whatsappOfficialGroupId = previousGroup;
    env.allowPrivateTestMode = previousPrivateMode;
  }
});

test('formats a health response without exposing configuration secrets', () => {
  const response = formatHealthStatus({
    branchName: 'ATC PNEUS MONTEIRO', whatsappConnected: true,
    databaseConnected: true, uploadsAccessible: true, uptimeSeconds: 90061, version: '1.0.0',
  });
  assert.match(response, /✅ TireFlow funcionando/);
  assert.match(response, /🏢 ATC PNEUS MONTEIRO/);
  assert.match(response, /Ativo há: 1d 1h 1min/);
  assert.doesNotMatch(response, /DATABASE_URL|OWNER_PHONE|BOSS_PRIVATE_NUMBER/);
});
