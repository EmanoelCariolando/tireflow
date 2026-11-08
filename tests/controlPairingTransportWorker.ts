import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PairingState } from '../src/control/pairing.js';
import { startPairingBridge, readPairingSnapshot } from '../src/control/pairingBridge.js';

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
const root = await mkdtemp(path.join(os.tmpdir(), 'control-qr-transport-'));
let close: (() => Promise<void>) | undefined;
try {
  const state = new PairingState();
  state.setQr('TIREFLOW_TEST_TRANSPORT_FIRST');
  close = await startPairingBridge(root, state);
  const filename = path.join(root, 'data', 'control-pairing-endpoint.json');
  const descriptorText = await readFile(filename, 'utf8');
  assert.doesNotMatch(descriptorText, /TIREFLOW_TEST|rows|revision/);
  const descriptor = JSON.parse(descriptorText) as { port: number; token: string };
  const first = await readPairingSnapshot(root, process.pid);
  assert.equal(first.state, 'qr');
  state.setQr('TIREFLOW_TEST_TRANSPORT_SECOND');
  const second = await readPairingSnapshot(root, process.pid);
  assert.equal(second.state, 'qr');
  if (first.state !== 'qr' || second.state !== 'qr') throw new Error('Expected QR');
  assert.notEqual(first.revision, second.revision);
  state.clear('authenticated');
  assert.deepEqual(await readPairingSnapshot(root, process.pid), { state: 'authenticated' });
  assert.deepEqual(await readPairingSnapshot(root, process.pid + 1), { state: 'unavailable' });
  const denied = await fetch(`http://127.0.0.1:${descriptor.port}/pairing`, {
    headers: { origin: 'https://external.example', 'x-pairing-token': descriptor.token },
  });
  assert.equal(denied.status, 403);
  await close(); close = undefined;
  await assert.rejects(access(filename));
  console.log('pairing-transport-ok');
} finally {
  if (close) await close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('control-qr-transport-'));
  await rm(root, { recursive: true, force: true });
}
