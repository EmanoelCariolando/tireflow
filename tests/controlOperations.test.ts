import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceController, backupOperation } from '../src/control/operations.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkUpdate } from '../src/control/updates.js';
import { parseControlConfig } from '../src/control/config.js';
import { createController } from '../src/control/app.js';

test('missing service configuration never executes a Windows command', async () => {
  const service = new ServiceController('/isolated', parseControlConfig({}), async () => { throw new Error('must not run'); });
  assert.equal((await service.status()).state, 'unavailable');
  await assert.rejects(service.control('start'), /Configure/);
});

test('service controls verify permissions and actual final state', async () => {
  const config = parseControlConfig({ serviceName: 'TireFlow-Test' });
  let canControl = false;
  let actual = 'offline';
  const executed: string[] = [];
  const service = new ServiceController('/isolated', config, async (file, args) => {
    assert.match(file, /powershell\.exe$/i);
    assert.equal(args.includes('-Command'), false);
    assert.equal(args[args.indexOf('-ExecutionPolicy') + 1], 'Bypass');
    const action = args[args.indexOf('-Action') + 1]!;
    executed.push(action);
    return JSON.stringify({ state: actual, canControl, pid: actual === 'online' ? 123 : null, uptimeSeconds: null });
  });
  await assert.rejects(service.control('start'), /permiss/);
  assert.deepEqual(executed, ['status']);
  canControl = true;
  await assert.rejects(service.control('start'), /estado esperado/);
  actual = 'online';
  assert.match((await service.control('restart')).message, /concluíd/);
  assert.deepEqual(executed.slice(-3), ['status', 'restart', 'status']);
});

test('service inspection failure is unavailable and never leaks subprocess output', async () => {
  const service = new ServiceController('/isolated', parseControlConfig({ serviceName: 'TireFlow-Test' }), async () => {
    throw new Error('password=secret stderr');
  });
  const status = await service.status();
  assert.equal(status.state, 'unavailable');
  assert.doesNotMatch(JSON.stringify(status), /secret|password/);
});

test('update check requires an explicit production branch and fixed GitHub remote', async () => {
  await assert.rejects(checkUpdate('/isolated', null, async () => { throw new Error('must not run'); }), /branch/);
  const outputs = [
    'https://github.com/example/tireflow.git\n',
    'master\n',
    'a'.repeat(40) + '\n',
    'b'.repeat(40) + '\trefs/heads/master\n',
  ];
  const result = await checkUpdate('/isolated', 'master', async (file, args) => {
    assert.equal(file, 'git');
    assert.equal(args.includes('pull'), false);
    return outputs.shift()!;
  });
  assert.equal(result.available, true);
  assert.equal(result.current, 'a'.repeat(40));
  assert.equal(result.latest, 'b'.repeat(40));
  await assert.rejects(checkUpdate('/isolated', 'master', async () => 'ssh://untrusted.example/repo'), /GitHub/);
});

test('controller keeps status accessible while a backup blocks all competing actions', async () => {
  let finish!: () => void;
  const controller = createController({
    service: { status: async () => ({ state: 'offline', pid: null, uptimeSeconds: null, canControl: true }), control: async () => ({ message: 'OK' }) },
    backup: async () => { await new Promise<void>(resolve => { finish = resolve; }); return { createdAt: '2026-10-31T12:00:00Z', verifiedAt: '2026-10-31T12:00:01Z', verification: 'verified', photoFiles: 2 }; },
    update: async () => { throw new Error('token=secret'); },
    overview: async () => ({ version: '1.0.0', whatsappConnected: null, uptimeSeconds: null, lastUpdate: null }),
  });
  const pending = controller.action('backup');
  assert.equal((await controller.status()).busy, 'backup');
  await assert.rejects(controller.action('start'), /andamento/);
  finish(); await pending;
  assert.equal((await controller.status()).backup?.verification, 'verified');
  await assert.rejects(controller.action('check-update'));
  const status = await controller.status();
  assert.equal(status.busy, null);
  assert.doesNotMatch(JSON.stringify(status), /secret|token=/);
  assert.equal(status.activities.at(-1)?.success, false);
});

test('backup creation is not forcibly timed out while it owns the persistent backup lock', async () => {
  const result = await backupOperation('/isolated', 'create', async (file, args, timeout) => {
    assert.equal(file, process.execPath);
    assert.equal(args.at(-1), 'create');
    assert.equal(timeout, 0);
    return JSON.stringify({ createdAt: '2026-10-31T12:00:00Z', verifiedAt: '2026-10-31T12:00:01Z', verification: 'verified', photoFiles: 1 });
  });
  assert.equal(result.verification, 'verified');
});

test('actual isolated backup inspector reports no backup without creating files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-worker-'));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', path.resolve('src/control/backupTask.ts'), 'inspect'], {
      env: { ...process.env, BACKUP_ROOT: root }, windowsHide: true, timeout: 15000,
    });
    assert.deepEqual(JSON.parse(stdout), { createdAt: null, verifiedAt: null, verification: 'unavailable', photoFiles: null });
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
