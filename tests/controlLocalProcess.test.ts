import assert from 'node:assert/strict';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalProcessController } from '../src/control/localProcess.js';

const worker = `
  import fs from 'node:fs';
  import {attachLocalPanelLifecycle} from ${JSON.stringify(new URL('../src/control/localLifecycle.ts', import.meta.url).href)};
  attachLocalPanelLifecycle(async () => {
    fs.writeFileSync('clean-stop.txt', 'cleanup completed');
    process.exit(0);
  });
  process.send('ready');
  setInterval(() => {}, 1000);
`;

test('local controls own a real disposable child and stop it through IPC before restarting', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-local-process-'));
  let child: ChildProcess | undefined;
  const local = new LocalProcessController(root, (file: string, args: string[], options: SpawnOptions) => {
    assert.equal(file, process.execPath);
    assert.deepEqual(args, ['--import', 'tsx', path.join(root, 'src', 'index.ts')]);
    assert.equal(options.cwd, root);
    assert.equal(options.shell, false);
    assert.equal(options.env?.TIREFLOW_CONTROL_LOCAL_CHILD, '1');
    child = spawn(file, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', worker], options);
    return child;
  });
  try {
    assert.equal((await local.status()).state, 'offline');
    await local.control('start');
    await once(child!, 'message');
    const first = await local.status();
    assert.equal(first.state, 'online');
    assert.equal(first.pid, child!.pid);
    await assert.rejects(local.control('start'), /estado|ativo/);
    await local.control('restart');
    await once(child!, 'message');
    assert.equal(await readFile(path.join(root, 'clean-stop.txt'), 'utf8'), 'cleanup completed');
    assert.notEqual((await local.status()).pid, first.pid);
    await local.control('stop');
    assert.equal((await local.status()).state, 'offline');
    assert.equal((await local.status()).pid, null);
    await assert.rejects(local.control('stop'), /estado|parado/);
    await local.shutdown();
    await assert.rejects(local.control('start'), /encerrando/);
    assert.equal((await local.status()).canControl, false);
  } finally {
    if ((await local.status()).state === 'online') await local.control('stop');
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed local launch remains stopped and hides subprocess error details', async () => {
  const local = new LocalProcessController(process.cwd(), () => { throw new Error('password=private'); });
  await assert.rejects(local.control('start'), error => error instanceof Error && !error.message.includes('private'));
  const status = await local.status();
  assert.equal(status.state, 'offline');
  assert.equal(status.canControl, true);
  assert.doesNotMatch(JSON.stringify(status), /password|private/);
});

test('an asynchronous launch failure and a spontaneous exit allow a later retry', { timeout: 15000 }, async () => {
  let fail = true;
  const local = new LocalProcessController(process.cwd(), () => fail
    ? spawn(path.join(os.tmpdir(), 'tireflow-nonexistent-executable'), [], { stdio: 'ignore' })
    : spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env }));
  await assert.rejects(local.control('start'), /iniciar/);
  assert.equal((await local.status()).state, 'offline');
  fail = false;
  await local.control('start');
  for (let tries = 0; tries < 100 && (await local.status()).state !== 'offline'; tries++) await delay(20);
  const status = await local.status();
  assert.equal(status.state, 'offline');
  assert.equal(status.pid, null);
  assert.match(status.message!, /falha/);
});

test('stopping before the bot finishes loading still calls cleanup and suppresses main startup', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-local-early-'));
  const source = `
    import fs from 'node:fs';
    import {attachLocalPanelLifecycle} from ${JSON.stringify(new URL('../src/control/localLifecycle.ts', import.meta.url).href)};
    await new Promise(resolve => setTimeout(resolve, 200));
    const mayStart = attachLocalPanelLifecycle(async () => {
      fs.writeFileSync('clean-stop.txt', 'cleaned');
      process.exit(0);
    });
    if (mayStart) { fs.writeFileSync('main-started.txt', 'must not happen'); setInterval(() => {}, 1000); }
  `;
  const local = new LocalProcessController(root, (file, _args, options) =>
    spawn(file, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', source], options));
  try {
    await local.control('start');
    await local.control('stop');
    assert.equal(await readFile(path.join(root, 'clean-stop.txt'), 'utf8'), 'cleaned');
    await assert.rejects(readFile(path.join(root, 'main-started.txt')), { code: 'ENOENT' });
  } finally {
    await local.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});

test('a CLI process without the local marker keeps its normal lifecycle even with an IPC parent', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-local-cli-'));
  const source = worker.replace('setInterval(() => {}, 1000);', "setTimeout(() => { fs.writeFileSync('cli-alive.txt', 'normal CLI'); process.exit(0); }, 300);");
  const environment = { ...process.env };
  delete environment.TIREFLOW_CONTROL_LOCAL_CHILD;
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', source], {
    cwd: root, env: environment, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  try {
    await once(child, 'message');
    const exited = once(child, 'exit');
    child.disconnect();
    await exited;
    assert.equal(await readFile(path.join(root, 'cli-alive.txt'), 'utf8'), 'normal CLI');
    await assert.rejects(readFile(path.join(root, 'clean-stop.txt')), { code: 'ENOENT' });
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});
