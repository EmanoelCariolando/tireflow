import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export type Action = 'start' | 'stop' | 'restart' | 'backup' | 'check-update';
const actions: Action[] = ['start', 'stop', 'restart', 'backup', 'check-update'];
export class ControlError extends Error {}

export class OperationGate {
  busy: string | null = null;
  async run<T>(name: string, operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ControlError('Há uma operação em andamento. Aguarde o resultado.');
    this.busy = name;
    try { return await operation(); } finally { this.busy = null; }
  }
}

interface PanelDependencies {
  port: number;
  status: () => Promise<unknown>;
  logs: () => Promise<unknown>;
  action: (action: Action) => Promise<unknown>;
  asset?: (pathname: string) => Promise<{ content: string; type: string } | null>;
}

export function createPanelHandler(dependencies: PanelDependencies): (request: Request) => Promise<Response> {
  const origin = `http://127.0.0.1:${dependencies.port}`;
  const token = randomBytes(32).toString('hex');
  let statusPending: Promise<unknown> | null = null;
  const headers = {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'cross-origin-resource-policy': 'same-origin', 'x-frame-options': 'DENY',
  };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  return async request => {
    try {
      if (request.headers.get('host') !== `127.0.0.1:${dependencies.port}` ||
        (request.headers.has('origin') && request.headers.get('origin') !== origin) ||
        ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) {
        return json({ error: 'Acesso permitido somente pela origem local do painel.' }, 403);
      }
      const url = new URL(request.url);
      if (url.origin !== origin || url.search) return json({ error: 'Endereço inválido.' }, 400);
      if (request.method === 'GET') {
        if (url.pathname === '/api/session') return json({ token });
        if (url.pathname === '/api/status') {
          if (!statusPending) statusPending = dependencies.status().finally(() => { statusPending = null; });
          return json(await statusPending);
        }
        if (url.pathname === '/api/logs') return json(await dependencies.logs());
        const asset = await dependencies.asset?.(url.pathname);
        return asset ? new Response(asset.content, { headers: { ...headers, 'content-type': asset.type } }) : json({ error: 'Não encontrado.' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
      const received = Buffer.from(request.headers.get('x-control-token') ?? '');
      const expected = Buffer.from(token);
      if (request.headers.get('origin') !== origin || received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return json({ error: 'Recarregue o painel para autorizar a ação.' }, 403);
      }
      const action = url.pathname.slice('/api/'.length) as Action;
      if (url.pathname !== `/api/${action}` || !actions.includes(action)) return json({ error: 'Ação não permitida.' }, 404);
      if (request.headers.get('content-type') !== 'application/json') return json({ error: 'Formato inválido.' }, 415);
      const text = await request.text();
      if (Buffer.byteLength(text) > 1024) return json({ error: 'Requisição muito grande.' }, 413);
      let body: unknown;
      try { body = JSON.parse(text); } catch { return json({ error: 'JSON inválido.' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => key !== 'confirmed') ||
        ('confirmed' in body && typeof body.confirmed !== 'boolean') ||
        (['stop', 'restart'].includes(action) && !('confirmed' in body && body.confirmed === true))) {
        return json({ error: 'Confirmação ou parâmetros inválidos.' }, 400);
      }
      return json(await dependencies.action(action));
    } catch (error) {
      return json({ error: error instanceof ControlError ? error.message : 'Operação falhou. Consulte a configuração e os registros locais com o administrador.' }, error instanceof ControlError ? 409 : 500);
    }
  };
}

export function startPanel(dependencies: PanelDependencies): Server {
  const handler = createPanelHandler(dependencies);
  const server = createServer({ requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 8192 }, (incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += Buffer.byteLength(chunk);
        if (size > 1024) { outgoing.writeHead(413); outgoing.end(); incoming.destroy(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const response = await handler(new Request(`http://127.0.0.1:${dependencies.port}${incoming.url ?? '/'}`, {
        method: incoming.method, headers,
        ...(['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? {} : { body: Buffer.concat(chunks).toString('utf8') }),
      }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => { outgoing.writeHead(400); outgoing.end(); });
  });
  server.maxHeadersCount = 40;
  server.listen({ host: '127.0.0.1', port: dependencies.port, exclusive: true });
  return server;
}
