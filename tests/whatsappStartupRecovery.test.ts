import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { exposeFunctionIfAbsent } = require('whatsapp-web.js/src/util/Puppeteer.js');

function bindingPage() {
  const bindings = new Map<string, () => string>();
  const windowFunctions = new Set<string>();
  return {
    bindings,
    windowFunctions,
    async evaluate(_callback: unknown, name: string) {
      return windowFunctions.has(name);
    },
    async exposeFunction(name: string, callback: () => string) {
      if (bindings.has(name)) {
        throw new Error(`Failed to add page binding with name ${name}: window['${name}'] already exists!`);
      }
      bindings.set(name, callback);
      // Puppeteer reserves the name before the browser has installed the function.
      await setImmediate();
      windowFunctions.add(name);
    },
  };
}

test('overlapping WhatsApp injections share a completed binding without crashing', async () => {
  const page = bindingPage();
  const name = 'onAuthAppStateChangedEvent';
  await Promise.all([
    exposeFunctionIfAbsent(page, name, () => 'first'),
    exposeFunctionIfAbsent(page, name, () => 'second'),
  ]);
  assert.equal(page.bindings.get(name)?.(), 'first');
  assert.ok(page.windowFunctions.has(name), 'Both callers must wait for the browser binding');
});

test('WhatsApp reinjection during navigation reuses the existing Puppeteer binding', async () => {
  const page = bindingPage();
  const name = 'onAuthAppStateChangedEvent';
  await exposeFunctionIfAbsent(page, name, () => 'original');
  page.windowFunctions.clear();
  await exposeFunctionIfAbsent(page, name, () => 'replacement');
  assert.equal(page.bindings.get(name)?.(), 'original');
});

test('failed WhatsApp binding registration propagates the error and can be retried', async (t) => {
  const page = bindingPage();
  const failure = new Error('Execution context was destroyed');
  const registration = t.mock.method(page, 'exposeFunction', async () => { throw failure; });
  await assert.rejects(exposeFunctionIfAbsent(page, 'onAuthAppStateChangedEvent', () => ''), failure);
  registration.mock.restore();
  await exposeFunctionIfAbsent(page, 'onAuthAppStateChangedEvent', () => 'recovered');
  assert.equal(page.bindings.get('onAuthAppStateChangedEvent')?.(), 'recovered');
});

test('a new WhatsApp page registers its own bindings after a browser restart', async () => {
  const first = bindingPage();
  const second = bindingPage();
  await exposeFunctionIfAbsent(first, 'onAuthAppStateChangedEvent', () => 'first page');
  await exposeFunctionIfAbsent(second, 'onAuthAppStateChangedEvent', () => 'second page');
  assert.equal(second.bindings.get('onAuthAppStateChangedEvent')?.(), 'second page');
});

const clientSource = readFileSync(
  path.join(process.cwd(), 'src', 'whatsapp', 'client.ts'),
  'utf8'
);
const indexSource = readFileSync(
  path.join(process.cwd(), 'src', 'index.ts'),
  'utf8'
);
const whatsappPatch = readFileSync(
  path.join(process.cwd(), 'patches', 'whatsapp-web.js+1.34.7.patch'),
  'utf8'
);

test('WhatsApp startup allows slow post-reboot synchronization and QR pairing', () => {
  assert.match(clientSource, /START_TIMEOUT_MS = 1_200_000/);
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

test('patched WhatsApp client waits safely through an internal Web navigation', () => {
  assert.match(
    whatsappPatch,
    /waitForFunction\(\s*\+\s*'window\.Debug\?\.VERSION != undefined'/
  );
  assert.match(
    whatsappPatch,
    /waitForFunction\(\s*\+\s*'window\.WWebJS != undefined'/
  );
});

test('a real authentication timeout is not silently ignored by the process handler', () => {
  assert.doesNotMatch(indexSource, /message === 'auth timeout'/);
  assert.match(indexSource, /Ignoring transient WhatsApp Web navigation rejection/);
});

test('startup diagnostics capture the socket and offline synchronization state', () => {
  for (const field of ['socketState', 'socketStream', 'hasSynced', 'offlineProgress']) {
    assert.match(clientSource, new RegExp(`${field}:`));
  }
});

test('shutdown verifies that Chrome exited even when destroy resolves successfully', () => {
  assert.match(clientSource, /waitForBrowserProcessExit\(browserProcess, BROWSER_EXIT_TIMEOUT_MS\)/);
  assert.match(clientSource, /forceStopBrowserProcessTree\(browserProcess\.pid\)/);
  assert.doesNotMatch(clientSource, /browserProcess && !browserProcess\.killed/);
});

test('a locked profile is recovered with backoff without restarting TireFlow', () => {
  assert.match(clientSource, /isExpectedBrowserProfileConflict\(error, WHATSAPP_PROFILE_PATH\)/);
  assert.match(clientSource, /recoverBrowserProfile\(WHATSAPP_PROFILE_PATH\)/);
  assert.match(clientSource, /PROFILE_CONFLICT_MAX_RETRY_MS = 120_000/);
});

test('every startup failure uses the complete shutdown path before exiting', () => {
  assert.match(
    indexSource,
    /catch \(error\) \{\s+console\.error\('Failed to start TireFlow:', error\);\s+await shutdown\('STARTUP_FAILURE', 1\)/,
  );
  assert.doesNotMatch(indexSource, /Failed to start TireFlow:[\s\S]{0,100}process\.exit\(1\)/);
});

test('abnormal exits are persisted for process-independent startup backoff', () => {
  assert.match(indexSource, /await waitForStartupRecoveryWindow\(\)/);
  assert.match(indexSource, /scheduleStartupRecoveryReset\(\)/);
  assert.match(indexSource, /await recordStartupFailure\(signal\)/);
  assert.match(indexSource, /await clearStartupRecoveryState\(\)/);
});
