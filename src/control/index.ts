import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from '../config/appPaths.js';
import { loadControlConfig } from './config.js';
import { ServiceController, backupOperation, runCommand } from './operations.js';
import { createController } from './app.js';
import { readHeartbeat } from './heartbeat.js';
import { LogReader } from './logs.js';
import { startPanel } from './server.js';
import { checkUpdate } from './updates.js';

async function main(): Promise<void> {
  const config = await loadControlConfig(PROJECT_ROOT);
  const service = new ServiceController(PROJECT_ROOT, config);
  const logs = new LogReader(path.join(PROJECT_ROOT, 'logs'));
  const metadata = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')) as { version?: string };
  let currentCommit: string | null = null;
  try {
    const hash = (await runCommand('git', ['-C', PROJECT_ROOT, 'rev-parse', '--verify', 'HEAD'], 5000)).trim();
    if (/^[a-f0-9]{40}$/.test(hash)) currentCommit = hash;
  } catch { /* Git metadata is optional for status and service control. */ }
  const controller = createController({
    service,
    backup: action => backupOperation(PROJECT_ROOT, action),
    update: () => checkUpdate(PROJECT_ROOT, config.productionBranch),
    overview: async state => {
      const heartbeat = state.state === 'online' ? await readHeartbeat(PROJECT_ROOT, state.pid) : null;
      return { version: metadata.version ?? null, whatsappConnected: heartbeat?.whatsappConnected ?? null,
        uptimeSeconds: state.uptimeSeconds, lastUpdate: null };
    },
  });
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
  const server = startPanel({
    port: config.port,
    status: async () => {
      const snapshot = await controller.status();
      if (config.serviceName) void controller.refreshBackup().catch(() => undefined);
      return { ...snapshot, currentCommit, productionBranch: config.productionBranch, serviceName: config.serviceName,
        updateBlocked: 'Aplicação aguarda confirmação da estratégia de atualização, migrations e recuperação.' };
    },
    logs: () => logs.read(),
    action: action => controller.action(action),
    asset: async pathname => {
      const asset = assets.get(pathname);
      return asset ? { content: await readFile(path.join(publicDirectory, asset[0]!), 'utf8'), type: asset[1]! } : null;
    },
  });
  server.on('listening', () => console.log(`TireFlow Control: http://127.0.0.1:${config.port}`));
  server.on('error', () => { console.error('Não foi possível abrir a porta local do painel.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); server.closeIdleConnections(); });
}

void main().catch(() => { console.error('Painel não iniciado. Confira control.config.json e o build.'); process.exitCode = 1; });
