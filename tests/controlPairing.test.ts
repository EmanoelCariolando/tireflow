import assert from 'node:assert/strict';
import test from 'node:test';
import { PairingState, validatePairingSnapshot, createPairingHandler } from '../src/control/pairing.js';

test('a new QR replaces the old matrix, and authentication removes the image', () => {
  const state = new PairingState();
  state.setQr('TIREFLOW_TEST_FIRST', 100000);
  const first = state.snapshot(100001);
  assert.equal(first.state, 'qr');
  state.setQr('TIREFLOW_TEST_SECOND', 101000);
  const second = state.snapshot(101001);
  assert.equal(second.state, 'qr');
  if (first.state !== 'qr' || second.state !== 'qr') throw new Error('QR expected');
  assert.notEqual(first.revision, second.revision);
  assert.notDeepEqual(first.rows, second.rows);
  assert.doesNotMatch(JSON.stringify(second), /TIREFLOW_TEST/);
  state.clear('authenticated');
  assert.deepEqual(state.snapshot(101002), { state: 'authenticated' });
  state.clear('connected');
  assert.deepEqual(state.snapshot(101003), { state: 'connected' });
});

test('expired or invalid pairing data never returns a QR', () => {
  const state = new PairingState();
  state.setQr('TIREFLOW_TEST', 100000);
  assert.deepEqual(state.snapshot(160001), { state: 'waiting' });
  state.setQr('X'.repeat(2049), 200000);
  assert.deepEqual(state.snapshot(200001), { state: 'waiting' });
  state.setQr('non-ascii-ç', 200000);
  assert.deepEqual(state.snapshot(200001), { state: 'waiting' });
  assert.deepEqual(validatePairingSnapshot({ state: 'qr', rows: ['<script>'], expiresAt: 220000, revision: 'bad' }, 200000), { state: 'unavailable' });
});

test('private QR publisher rejects foreign hosts, browser origins and missing credentials', async () => {
  const state = new PairingState();
  state.setQr('TIREFLOW_TEST_ONLY');
  const handler = createPairingHandler(state, 49190, 'a'.repeat(64));
  const get = (headers = {}) => handler(new Request('http://127.0.0.1:49190/pairing', { headers: { host: '127.0.0.1:49190', ...headers } }));
  assert.equal((await get()).status, 403);
  assert.equal((await get({ 'x-pairing-token': 'a'.repeat(64), host: 'evil.example' })).status, 403);
  assert.equal((await get({ 'x-pairing-token': 'a'.repeat(64), origin: 'https://evil.example' })).status, 403);
  const response = await get({ 'x-pairing-token': 'a'.repeat(64) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { pid: number; pairing: { state: string } };
  assert.equal(body.pid, process.pid);
  assert.equal(body.pairing.state, 'qr');
  assert.doesNotMatch(JSON.stringify(body), /TIREFLOW_TEST_ONLY|aaaaaaaaaaaa/);
});
