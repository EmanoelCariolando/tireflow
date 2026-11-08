import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPairingSnapshot } from '../src/control/pairingBridge.js';
import { PairingState } from '../src/control/pairing.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('QR bridge reads only the descriptor for the expected active process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'control-pairing-reader-'));
  try {
    await mkdir(path.join(root, 'data'));
    const descriptor = path.join(root, 'data', 'control-pairing-endpoint.json');
    await writeFile(descriptor, JSON.stringify({ pid: 123, port: 49191, token: 'a'.repeat(64) }));
    const never = async () => { throw new Error('wrong process must not be queried'); };
    assert.deepEqual(await readPairingSnapshot(root, null, never), { state: 'unavailable' });
    assert.deepEqual(await readPairingSnapshot(root, 124, never), { state: 'unavailable' });
    const state = new PairingState();
    state.setQr('TIREFLOW_TEST_READER');
    const snapshot = await readPairingSnapshot(root, 123, async (port, token) => {
      assert.equal(port, 49191);
      assert.equal(token, 'a'.repeat(64));
      return { pid: 123, pairing: state.snapshot(), extraSecret: 'MUST_NOT_ESCAPE' };
    });
    assert.equal(snapshot.state, 'qr');
    assert.doesNotMatch(JSON.stringify(snapshot), /TIREFLOW_TEST_READER|MUST_NOT_ESCAPE|aaaaaaaa/);
    assert.deepEqual(await readPairingSnapshot(root, 123, async () => ({ pid: 456, pairing: state.snapshot() })), { state: 'unavailable' });
    assert.deepEqual(await readPairingSnapshot(root, 123, async () => { throw new Error('transport failed'); }), { state: 'unavailable' });
    await writeFile(descriptor, JSON.stringify({ pid: 123, port: 'https://evil.example', token: 'a'.repeat(64) }));
    assert.deepEqual(await readPairingSnapshot(root, 123, never), { state: 'unavailable' });
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});

test('QR travels only through the credential-protected loopback channel in an isolated worker', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tests/controlPairingTransportWorker.ts'], {
    env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true, timeout: 15000,
  });
  assert.equal(stdout.trim(), 'pairing-transport-ok');
});
