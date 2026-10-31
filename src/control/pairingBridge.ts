import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPairingHandler, validatePairingSnapshot, type PairingState, type PairingSnapshot } from './pairing.js';

const descriptorName = 'control-pairing-endpoint.json';

export async function startPairingBridge(root: string, state: PairingState): Promise<() => Promise<void>> {
  let handler: ReturnType<typeof createPairingHandler> | undefined;
  const server = createServer({ requestTimeout: 1500, headersTimeout: 1000, maxHeaderSize: 4096 }, (incoming, outgoing) => {
    if (!handler || incoming.headers['transfer-encoding'] || Number(incoming.headers['content-length'] ?? 0) > 0) {
      outgoing.writeHead(400); outgoing.end(); return;
    }
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Pairing unavailable');
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const response = handler(new Request(`http://127.0.0.1:${address.port}${incoming.url ?? '/'}`, { method: incoming.method, headers }));
      void response.text().then(body => { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(body); }).catch(() => { outgoing.end(); });
    } catch { outgoing.writeHead(400); outgoing.end(); }
  });
  server.maxHeadersCount = 12;
  server.maxConnections = 8;
  server.setTimeout(2000, socket => socket.destroy());
  const filename = path.join(root, 'data', descriptorName);
  const temporary = `${filename}.${process.pid}.tmp`;
  let descriptor = '';
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Pairing unavailable');
    const token = randomBytes(32).toString('hex');
    handler = createPairingHandler(state, address.port, token);
    descriptor = JSON.stringify({ pid: process.pid, port: address.port, token });
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(temporary, descriptor, { mode: 0o600 });
    await rename(temporary, filename);
    server.unref();
  } catch {
    server.close(); server.closeAllConnections();
    await unlink(temporary).catch(() => undefined);
    throw new Error('Canal local de autenticação indisponível.');
  }
  return async () => {
    state.clear('unavailable');
    server.close(); server.closeAllConnections();
    try { if (await readFile(filename, 'utf8') === descriptor) await unlink(filename); } catch { /* A stale descriptor cannot pass the PID/credential checks. */ }
  };
}

function requestPairing(port: number, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path: '/pairing', method: 'GET', headers: { 'x-pairing-token': token }, agent: false, timeout: 1000 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Pairing unavailable')); return; }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 65536) { request.destroy(new Error('Pairing unavailable')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Pairing unavailable')); }
      });
      response.on('error', reject);
    });
    request.once('timeout', () => request.destroy(new Error('Pairing unavailable')));
    request.once('error', reject);
    request.end();
  });
}

export async function readPairingSnapshot(root: string, pid: number | null, request = requestPairing): Promise<PairingSnapshot> {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return { state: 'unavailable' };
  try {
    const filename = path.join(root, 'data', descriptorName);
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024) return { state: 'unavailable' };
    const descriptor = JSON.parse(await readFile(filename, 'utf8')) as { pid?: unknown; port?: unknown; token?: unknown };
    if (descriptor.pid !== pid || !Number.isInteger(descriptor.port) || Number(descriptor.port) < 1024 || Number(descriptor.port) > 65535 ||
      typeof descriptor.token !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.token)) return { state: 'unavailable' };
    const response = await request(Number(descriptor.port), descriptor.token) as { pid?: unknown; pairing?: unknown } | null;
    if (!response || response.pid !== pid) return { state: 'unavailable' };
    return validatePairingSnapshot(response.pairing);
  } catch { return { state: 'unavailable' }; }
}
