import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';

type PairingStatus = 'waiting' | 'authenticated' | 'connected' | 'unavailable';
export type PairingSnapshot = { state: PairingStatus } | { state: 'qr'; revision: string; rows: string[]; expiresAt: number };
const lifetime = 60000;
const QRCode = createRequire(import.meta.url)('qrcode-terminal/vendor/QRCode') as new (version: number, correction: number) => {
  addData(text: string): void; make(): void; getModuleCount(): number; isDark(row: number, column: number): boolean;
};

export class PairingState {
  private current: PairingSnapshot = { state: 'waiting' };

  setQr(value: string, now = Date.now()): void {
    this.clear('waiting');
    if (typeof value !== 'string' || !/^[\x20-\x7e]{1,2048}$/.test(value)) return;
    try {
      const code = new QRCode(-1, 1);
      code.addData(value);
      code.make();
      const size = code.getModuleCount();
      const rows = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => code.isDark(row, column) ? '1' : '0').join(''));
      this.current = { state: 'qr', revision: randomUUID(), rows, expiresAt: now + lifetime };
    } catch { this.clear('unavailable'); }
  }

  clear(state: PairingStatus): void { this.current = { state }; }

  snapshot(now = Date.now()): PairingSnapshot {
    if (this.current.state !== 'qr') return { state: this.current.state };
    if (now >= this.current.expiresAt) { this.clear('waiting'); return { state: 'waiting' }; }
    return { ...this.current, rows: [...this.current.rows] };
  }
}

export const whatsappPairing = new PairingState();

export function validatePairingSnapshot(value: unknown, now = Date.now()): PairingSnapshot {
  if (!value || typeof value !== 'object') return { state: 'unavailable' };
  const input = value as Record<string, unknown>;
  if (typeof input.state === 'string' && ['waiting', 'authenticated', 'connected', 'unavailable'].includes(input.state)) return { state: input.state as PairingStatus };
  const rows = input.rows;
  if (input.state !== 'qr' || typeof input.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(input.revision) ||
    typeof input.expiresAt !== 'number' || !Number.isFinite(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + lifetime ||
    !Array.isArray(rows) || rows.length < 21 || rows.length > 177 || (rows.length - 21) % 4 !== 0 ||
    rows.some(row => typeof row !== 'string' || row.length !== rows.length || !/^[01]+$/.test(row))) return { state: 'unavailable' };
  return { state: 'qr', revision: input.revision, expiresAt: input.expiresAt, rows: [...rows] as string[] };
}

export function createPairingHandler(state: PairingState, port: number, token: string): (request: Request) => Response {
  return request => {
    const received = Buffer.from(request.headers.get('x-pairing-token') ?? '');
    const expected = Buffer.from(token);
    const headers = { 'cache-control': 'no-store', 'content-type': 'application/json', 'cross-origin-resource-policy': 'same-origin', 'x-content-type-options': 'nosniff' };
    if (request.method !== 'GET' || request.url !== `http://127.0.0.1:${port}/pairing` ||
      request.headers.get('host') !== `127.0.0.1:${port}` || request.headers.has('origin') || request.headers.has('sec-fetch-site') ||
      received.length !== expected.length || !timingSafeEqual(received, expected)) return Response.json({ error: 'Forbidden' }, { status: 403, headers });
    return Response.json({ pid: process.pid, pairing: state.snapshot() }, { headers });
  };
}
