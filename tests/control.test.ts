import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseControlConfig } from '../src/control/config.js';
import { LogReader } from '../src/control/logs.js';
import { readHeartbeat, writeHeartbeat } from '../src/control/heartbeat.js';
import { createPanelHandler, OperationGate } from '../src/control/server.js';

test('configuration rejects shell characters, external addresses and invalid branch names', () => {
  assert.throws(() => parseControlConfig({ serviceName: 'bot;whoami' }));
  assert.throws(() => parseControlConfig({ host: '0.0.0.0' }));
  assert.throws(() => parseControlConfig({ productionBranch: '--upload-pack=bad' }));
  assert.throws(() => parseControlConfig({ port: 0 }));
  assert.equal(parseControlConfig({ serviceName: 'TireFlow-Monteiro' }).serviceName, 'TireFlow-Monteiro');
});

test('logs tail incrementally, hide confidential details and handle truncation and rotation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-log-'));
  try {
    const file = path.join(root, 'tireflow-2026-10-31.log');
    await writeFile(file, '[2026-10-31T12:00:00.000Z] [INFO] [TEST] [PROCESS] TireFlow instance starting. {"token":"secret"}\n' +
      '[2026-10-31T12:00:01.000Z] [ERROR] [TEST] Failed to start TireFlow: password=secret 5511999999999@c.us\n' +
      'QR 2@super-secret-qr\n' + '[2026-10-31T12:00:02.000Z] [INFO] [TEST] Pedido cliente João R$500 senha123\n');
    const reader = new LogReader(root);
    const first = await reader.read();
    assert.ok(first.length >= 2);
    assert.doesNotMatch(JSON.stringify(first), /secret|551199|João|senha123|super-secret/);
    assert.deepEqual(await reader.read(), first);
    await appendFile(file, '[2026-10-31T12:00:03.000Z] [WARN] [TEST] [HEALTH] Periodic check failed.\n');
    assert.equal((await reader.read()).filter(x => x.level === 'WARN').length, 1);
    await writeFile(file, '[2026-10-31T12:00:04.000Z] [ERROR] [TEST] [PROCESS] Uncaught exception.\n');
    assert.equal((await reader.read()).at(-1)?.level, 'ERROR');
    await writeFile(path.join(root, 'tireflow-2026-10-31-1.log'), '[2026-10-31T12:00:05.000Z] [INFO] [TEST] [HEALTH] Periodic status.\n');
    assert.equal((await reader.read()).at(-1)?.level, 'INFO');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('heartbeat expires and rejects a different process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-heartbeat-'));
  try {
    await mkdir(path.join(root, 'data'));
    await writeHeartbeat(root, { pid: 123, uptimeSeconds: 12, whatsappConnected: true }, 100000);
    assert.equal((await readHeartbeat(root, 123, 110000))?.whatsappConnected, true);
    assert.equal(await readHeartbeat(root, 124, 110000), null);
    assert.equal(await readHeartbeat(root, 123, 150001), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('initial log history keeps the base file before numbered rotations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-order-'));
  try {
    await writeFile(path.join(root, 'tireflow-2026-10-31.log'), '[2026-10-31T12:00:00.000Z] [INFO] [TEST] [PROCESS] TireFlow instance starting.\n');
    await writeFile(path.join(root, 'tireflow-2026-10-31-1.log'), '[2026-10-31T12:01:00.000Z] [ERROR] [TEST] [PROCESS] Uncaught exception.\n');
    const entries = await new LogReader(root).read();
    assert.deepEqual(entries.map(entry => entry.level), ['INFO', 'ERROR']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('daily file logs retain WhatsApp progress and startup messages with their real source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-operational-log-'));
  try {
    const file = 'tireflow-2026-10-25.log';
    const messages = [
      'Loading: 0% - WhatsApp',
      '✅ WhatsApp authentication successful.',
      '✅ WhatsApp client is ready!',
      '🤖 TireFlow bot is now listening for messages.',
      'Loading: 99% - WhatsApp',
      "[WA PAGE error] The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.",
      '[WA PAGE error] Failed to load resource: the server responded with a status of 400 ()',
      '[NOTIFICATION] Private notification targets warmed up (2/2) in 1216ms.',
      '[REPORT] Daily report scheduler enabled for 18:00.',
      '[MONTHLY_REPORT] Scheduler disabled. MONTHLY_REPORT_TIME is not configured.',
      '[PENDING_SALE] Reminders enabled at 09:30 and 16:00.',
      'Bot is running. Press Ctrl+C to stop.',
      '[REPORT] Daily report sent for 2026-10-24.',
    ];
    await writeFile(path.join(root, file), messages.map(message => `[2026-10-25T02:22:30.896Z] [INFO] [TEST] ${message}\n`).join('') +
      "[2026-10-25T02:22:30.896Z] [INFO] [TEST] [WA PAGE warn] The resource https://example.test/asset.js was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.\n");
    const reader = new LogReader(root);
    const entries = await reader.read();
    assert.deepEqual(entries.map(entry => entry.message), [...messages,
      "[WA PAGE warn] The resource [URL OCULTA] was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally."]);
    assert.ok(entries.every(entry => entry.file === file && entry.timestamp === '2026-10-25T02:22:30.896Z'));
    assert.deepEqual(await reader.read(), entries);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('operational logs redact structured payloads, identifiers, credentials, URLs and QR data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-private-log-'));
  try {
    const messages = [
      '[MESSAGE] Incoming authorized message. {"command":"PRIVATE_COMMAND","body":"PRIVATE_BODY","user":"PRIVATE_USER"}',
      '[MESSAGE] PRIVATE_FREE_TEXT',
      '[PNEU] 5511999999999@lid -> 175/75 R14 (4 produtos) queryMs=17',
      '[WA PAGE warn] The resource https://example.test/path/PRIVATE_URL?token=PRIVATE_TOKEN was preloaded but not used.',
      '[WA PAGE warn] Failed decrypting PRIVATE_CUSTOMER_TEXT',
      '[WA PAGE warn] sessionKey PRIVATE_SESSION_KEY',
      "[WA PAGE warn] The resource https://example.test/o'hara/PRIVATE_URL?session=PRIVATE_VALUE was preloaded but not used.",
      '[BACKUP] Backup concluído e verificado: \\\\server\\PRIVATE_SHARE\\backup',
      '[BACKUP] Backup concluído e verificado: C:\\Users\\PRIVATE_FIRST PRIVATE_LAST\\backup',
      '[PROCESS] request failed Authorization: Bearer PRIVATE_AUTH',
      '[HEALTH] token=PRIVATE_TOKEN',
      '[REPORT] body: PRIVATE_BODY',
      '[WHATSAPP] QR received: 2@PRIVATE_QR',
      '[WHATSAPP] contact PRIVATE_EMAIL@example.test 5511888888888',
      '[HEALTH] Periodic status. {"password":"PRIVATE_PASSWORD","whatsapp":true}',
    ];
    await writeFile(path.join(root, 'tireflow-2026-10-25.log'), messages.map(message => `[2026-10-25T02:22:30.896Z] [INFO] [TEST] ${message}\n`).join(''));
    const entries = await new LogReader(root).read();
    assert.equal(entries.length, messages.length);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_|5511999999999|5511888888888|@lid|https:\/\//);
    assert.ok(entries.some(entry => entry.message.includes('175/75 R14')));
    assert.equal(entries.filter(entry => entry.message.includes('was preloaded but not used')).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a running log reader follows a new daily file and jumps to recent data after a large append', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-day-log-'));
  try {
    await writeFile(path.join(root, 'tireflow-2026-10-24.log'), '[2026-10-24T23:59:59.000Z] [INFO] [TEST] Loading: 0% - WhatsApp\n');
    const reader = new LogReader(root);
    await reader.read();
    const today = path.join(root, 'tireflow-2026-10-25.log');
    await writeFile(today, '[2026-10-25T00:00:00.000Z] [INFO] [TEST] Loading: 1% - WhatsApp\n');
    assert.ok((await reader.read()).some(entry => entry.file === 'tireflow-2026-10-25.log'));
    await appendFile(today, 'unstructured payload that must not be served\n'.repeat(5000) + '[2026-10-25T00:01:00.000Z] [INFO] [TEST] Loading: 99% - WhatsApp\n');
    assert.equal((await reader.read()).at(-1)?.message, 'Loading: 99% - WhatsApp');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the log view retains only the latest 300 events in chronological order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-bounded-log-'));
  try {
    const rows = Array.from({ length: 400 }, (_, index) =>
      `[${new Date(Date.UTC(2026, 9, 25, 0, 0, index)).toISOString()}] [INFO] [TEST] Loading: ${index % 101}% - WhatsApp\n`);
    await writeFile(path.join(root, 'tireflow-2026-10-25.log'), rows.join(''));
    const entries = await new LogReader(root).read();
    assert.equal(entries.length, 300);
    assert.equal(entries[0]?.timestamp, '2026-10-25T00:01:40.000Z');
    assert.equal(entries.at(-1)?.timestamp, '2026-10-25T00:06:39.000Z');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('administrative operations reject overlap and release the lock after failure', async () => {
  const gate = new OperationGate();
  let finish!: () => void;
  const running = gate.run('backup', () => new Promise<void>(resolve => { finish = resolve; }));
  await assert.rejects(gate.run('start', async () => undefined), /andamento/);
  finish(); await running;
  await assert.rejects(gate.run('backup', async () => { throw new Error('failed'); }));
  await gate.run('start', async () => undefined);
  assert.equal(gate.busy, null);
});

test('HTTP security blocks rebinding, foreign origins, missing CSRF and arbitrary actions', async () => {
  const calls: string[] = [];
  const handle = createPanelHandler({
    port: 4280,
    status: async () => ({ service: { state: 'offline' } }),
    logs: async () => [],
    action: async action => { calls.push(action); return { message: 'Concluído' }; },
  });
  const request = (route: string, method = 'GET', headers = {}, body?: string) => handle(new Request(`http://127.0.0.1:4280${route}`, {
    method, headers: { host: '127.0.0.1:4280', ...headers }, body,
  }));
  assert.equal((await request('/api/status', 'GET', { host: 'evil.example:4280' })).status, 403);
  assert.equal((await request('/api/session', 'GET', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/start', 'POST', { origin: 'http://127.0.0.1:4280' }, '{}')).status, 403);
  const { token } = await (await request('/api/session')).json() as { token: string };
  const headers = { origin: 'http://127.0.0.1:4280', 'content-type': 'application/json', 'x-control-token': token };
  assert.equal((await request('/api/start', 'POST', { ...headers, origin: 'null' }, '{}')).status, 403);
  assert.equal((await request('/api/exec', 'POST', headers, '{}')).status, 404);
  assert.equal((await request('/api/stop', 'POST', headers, '{}')).status, 400);
  assert.equal((await request('/api/start', 'POST', headers, '{"command":"calc.exe"}')).status, 400);
  assert.equal((await request('/api/start', 'POST', headers, '{}')).status, 200);
  assert.deepEqual(calls, ['start']);
  assert.equal((await request('/api/status')).status, 200);
});

test('overlapping HTTP status polls share one inspection and a later poll refreshes', async () => {
  let calls = 0;
  let finish!: (value: unknown) => void;
  const handle = createPanelHandler({ port: 4280, logs: async () => [], action: async () => ({}), status: () => {
    calls += 1;
    return new Promise(resolve => { finish = resolve; });
  } });
  const request = () => handle(new Request('http://127.0.0.1:4280/api/status', { headers: { host: '127.0.0.1:4280' } }));
  const first = request();
  const second = request();
  assert.equal(calls, 1);
  finish({ service: { state: 'offline' } });
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  const third = request();
  assert.equal(calls, 2);
  finish({ service: { state: 'online' } });
  assert.equal((await (await third).json() as { service: { state: string } }).service.state, 'online');
});
