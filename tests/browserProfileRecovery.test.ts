import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyBrowserProcesses,
  isExpectedBrowserProfileConflict,
  recoverBrowserProfile,
  type BrowserProcessSnapshot,
} from '../src/whatsapp/browserProfileRecovery.js';

function snapshot(overrides: Partial<BrowserProcessSnapshot> = {}): BrowserProcessSnapshot {
  return {
    processId: 200,
    parentProcessId: 100,
    parentExists: false,
    creationTime: '2026-08-26T14:00:01.000Z',
    parentCreationTime: '',
    ...overrides,
  };
}

test('recognizes a Puppeteer conflict only for the configured WhatsApp profile', () => {
  const profilePath = 'C:\\TireFlow\\Congo\\data\\wwebjs_auth\\session-tireflowcongo';
  const expected = new Error(
    `The browser is already running for ${profilePath}. Use a different userDataDir.`,
  );
  const otherBranch = new Error(
    'The browser is already running for C:\\TireFlow\\Monteiro\\session-other.',
  );

  assert.equal(isExpectedBrowserProfileConflict(expected, profilePath), true);
  assert.equal(isExpectedBrowserProfileConflict(otherBranch, profilePath), false);
  assert.equal(isExpectedBrowserProfileConflict(new Error('Network failed'), profilePath), false);
});

test('preserves a browser whose original parent process is still active', () => {
  const result = classifyBrowserProcesses([
    snapshot({ parentExists: true, parentCreationTime: '2026-08-26T14:00:00.000Z' }),
  ], 999);

  assert.equal(result.active.length, 1);
  assert.equal(result.orphaned.length, 0);
});

test('preserves a live parent when Windows omits process creation timestamps', () => {
  const result = classifyBrowserProcesses([
    snapshot({ parentExists: true, creationTime: '', parentCreationTime: '' }),
  ], 999);

  assert.equal(result.active.length, 1);
  assert.equal(result.orphaned.length, 0);
});

test('recovers a browser whose parent process no longer exists', () => {
  const result = classifyBrowserProcesses([snapshot()], 999);

  assert.equal(result.active.length, 0);
  assert.equal(result.orphaned.length, 1);
});

test('treats a reused parent PID as orphaned when the new parent is newer than Chrome', () => {
  const result = classifyBrowserProcesses([
    snapshot({ parentExists: true, parentCreationTime: '2026-08-26T14:05:00.000Z' }),
  ], 999);

  assert.equal(result.active.length, 0);
  assert.equal(result.orphaned.length, 1);
});

test('does not classify the current startup attempt as an old owner', () => {
  const result = classifyBrowserProcesses([
    snapshot({
      parentProcessId: 999,
      parentExists: true,
      parentCreationTime: '2026-08-26T14:00:00.000Z',
    }),
  ], 999);

  assert.equal(result.active.length, 0);
  assert.equal(result.orphaned.length, 0);
  assert.equal(result.spawnedByCurrentProcess.length, 1);
});

test('does not terminate a browser while its original owner is alive', async () => {
  let stopCalls = 0;
  const result = await recoverBrowserProfile('C:\\TireFlow\\session-test', {
    platform: 'win32',
    currentProcessId: 999,
    inspectProcesses: async () => [
      snapshot({ parentExists: true, parentCreationTime: '2026-08-26T14:00:00.000Z' }),
    ],
    stopProcessTree: async () => {
      stopCalls += 1;
    },
  });

  assert.equal(result, 'active_owner');
  assert.equal(stopCalls, 0);
});

test('terminates the exact orphan and confirms it disappeared before recovery', async () => {
  const stoppedProcessIds: number[] = [];
  let inspectionCount = 0;
  const result = await recoverBrowserProfile('C:\\TireFlow\\session-test', {
    platform: 'win32',
    currentProcessId: 999,
    inspectProcesses: async () => {
      inspectionCount += 1;
      return inspectionCount === 1 ? [snapshot({ processId: 321 })] : [];
    },
    stopProcessTree: async (processId) => {
      stoppedProcessIds.push(processId);
    },
  });

  assert.equal(result, 'recovered_orphan');
  assert.deepEqual(stoppedProcessIds, [321]);
  assert.equal(inspectionCount, 2);
});

test(
  'removes only a stale Chrome lock and preserves WhatsApp session data',
  { skip: process.platform !== 'win32' },
  async () => {
    const profilePath = await mkdtemp(path.join(os.tmpdir(), 'tireflow-profile-recovery-'));
    const sessionFile = path.join(profilePath, 'Default', 'Cookies');
    try {
      await mkdir(path.dirname(sessionFile), { recursive: true });
      await writeFile(path.join(profilePath, 'lockfile'), 'stale', 'utf8');
      await writeFile(sessionFile, 'session-must-remain', 'utf8');

      assert.equal(
        await recoverBrowserProfile(profilePath, {
          platform: 'win32',
          inspectProcesses: async () => [],
        }),
        'removed_stale_lock',
      );
      assert.equal(await readFile(sessionFile, 'utf8'), 'session-must-remain');
    } finally {
      await rm(profilePath, { recursive: true, force: true });
    }
  },
);
