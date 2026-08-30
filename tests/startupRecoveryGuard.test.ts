import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearStartupRecoveryState,
  getStartupRetryDelayMs,
  recordStartupFailure,
  waitForStartupRecoveryWindow,
} from '../src/services/startupRecoveryGuard.js';

test('uses bounded exponential delays for consecutive failures', () => {
  assert.equal(getStartupRetryDelayMs(1), 0);
  assert.equal(getStartupRetryDelayMs(2), 15_000);
  assert.equal(getStartupRetryDelayMs(3), 30_000);
  assert.equal(getStartupRetryDelayMs(4), 60_000);
  assert.equal(getStartupRetryDelayMs(5), 120_000);
  assert.equal(getStartupRetryDelayMs(20), 120_000);
});

test('persists consecutive failures and waits before the next process attempt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tireflow-startup-recovery-'));
  const statePath = path.join(directory, 'state.json');
  const delays: number[] = [];
  try {
    assert.equal(await recordStartupFailure('STARTUP_FAILURE', { statePath, nowMs: 1000 }), 1);
    assert.equal(await recordStartupFailure('WHATSAPP_DISCONNECTED', { statePath, nowMs: 2000 }), 2);

    const delay = await waitForStartupRecoveryWindow({
      statePath,
      nowMs: 3000,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    assert.equal(delay, 15_000);
    assert.deepEqual(delays, [15_000]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('forgets an old failure instead of delaying a later normal startup', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tireflow-startup-recovery-'));
  const statePath = path.join(directory, 'state.json');
  let slept = false;
  try {
    await recordStartupFailure('OLD_FAILURE', { statePath, nowMs: 1000 });
    const delay = await waitForStartupRecoveryWindow({
      statePath,
      nowMs: 31 * 60 * 1000,
      sleep: async () => {
        slept = true;
      },
    });

    assert.equal(delay, 0);
    assert.equal(slept, false);
    await clearStartupRecoveryState({ statePath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
