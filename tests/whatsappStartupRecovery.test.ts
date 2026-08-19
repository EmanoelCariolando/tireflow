import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const clientSource = readFileSync(
  path.join(process.cwd(), 'src', 'whatsapp', 'client.ts'),
  'utf8'
);
const whatsappPatch = readFileSync(
  path.join(process.cwd(), 'patches', 'whatsapp-web.js+1.34.7.patch'),
  'utf8'
);

test('WhatsApp startup allows slow post-reboot synchronization', () => {
  assert.match(clientSource, /START_TIMEOUT_MS = 600_000/);
  assert.match(clientSource, /READY_RECOVERY_RETRY_MS = 5000/);
  assert.match(clientSource, /scheduleRecovery\(READY_RECOVERY_RETRY_MS\)/);
});

test('manual ready recovery updates the public connection state', () => {
  assert.match(clientSource, /if \(attached\) \{\s+markWhatsAppReady\('manual recovery'\)/);
  assert.match(
    clientSource,
    /function markWhatsAppReady[\s\S]*?whatsappReady = true[\s\S]*?manual recovery/
  );
});

test('patched WhatsApp client resumes injection after offline sync reaches 100 percent', () => {
  assert.match(whatsappPatch, /Socket\.hasSynced === true \|\| readOfflineProgress\(\) >= 100/);
  assert.match(whatsappPatch, /_wwjsReadyRecoveryInterval = setInterval/);
  assert.match(whatsappPatch, /completeInitializationWhenSynced\(\)/);
});

test('startup diagnostics capture the socket and offline synchronization state', () => {
  for (const field of ['socketState', 'socketStream', 'hasSynced', 'offlineProgress']) {
    assert.match(clientSource, new RegExp(`${field}:`));
  }
});
