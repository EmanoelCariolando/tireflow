import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from '../config/appPaths.js';
import { loadControlConfig } from './config.js';
import { ServiceController, backupOperation, runCommand } from './operations.js';
import { createController } from './app.js';
import { readHeartbeat } from './heartbeat.js';
import { LogReader } from './logs.js';
import { ControlError, startPanel } from './server.js';
import { checkUpdate } from './updates.js';
import { readPairingSnapshot } from './pairingBridge.js';
import type { ServiceStatus } from './operations.js';
import { LocalProcessController } from './localProcess.js';

async function main(): Promise<void> {
  const config = await loadControlConfig(PROJECT_ROOT);
  const localMode = process.argv.includes('--local');
  const local = localMode ? new LocalProcessController(PROJECT_ROOT) : null;
  const service = local ?? new ServiceController(PROJECT_ROOT, config);
  const port = localMode ? 4282 : config.port;
  const logs = new LogReader(path.join(PROJECT_ROOT, 'logs'));
  const metadata = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')) as { version?: string };
  let currentCommit: string | null = null;
  try {
    const hash = (await runCommand('git', ['-C', PROJECT_ROOT, 'rev-parse', '--verify', 'HEAD'], 5000)).trim();
    if (/^[a-f0-9]{40}$/.test(hash)) currentCommit = hash;
  } catch { /* Git metadata is optional for status and service control. */ }
  const controller = createController({
    service,
    backup: action => {
      if (localMode) throw new ControlError('Backups estão desativados no modo local do painel.');
      return backupOperation(PROJECT_ROOT, action);
    },
    update: () => {
      if (localMode) throw new ControlError('Atualizações estão desativadas no modo local do painel.');
      return checkUpdate(PROJECT_ROOT, config.productionBranch);
    },
    overview: async state => {
      const heartbeat = state.state === 'online' ? await readHeartbeat(PROJECT_ROOT, state.pid) : null;
      return { version: metadata.version ?? null, whatsappConnected: heartbeat?.whatsappConnected ?? null,
        uptimeSeconds: state.uptimeSeconds, lastUpdate: null };
    },
  });
  let recentService: ServiceStatus | null = null;
  let serviceCheckedAt = 0;
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
  const server = startPanel({
    port,
    status: async () => {
      const snapshot = await controller.status();
      recentService = snapshot.service;
      serviceCheckedAt = Date.now();
      if (!localMode && config.serviceName) void controller.refreshBackup().catch(() => undefined);
      return { ...snapshot, currentCommit, controlMode: localMode ? 'local' : 'nssm',
        productionBranch: localMode ? null : config.productionBranch, serviceName: localMode ? 'Bot local (npm run dev)' : config.serviceName,
        updateBlocked: localMode ? 'Atualizações e backups desativados neste modo local.' : 'Aplicação aguarda confirmação da estratégia de atualização, migrations e recuperação.' };
    },
    logs: () => logs.read(),
    pairing: () => readPairingSnapshot(PROJECT_ROOT, recentService?.state === 'online' && Date.now() - serviceCheckedAt < 7500 ? recentService.pid : null),
    action: action => controller.action(action),
    asset: async pathname => {
      const asset = assets.get(pathname);
      return asset ? { content: await readFile(path.join(publicDirectory, asset[0]!), 'utf8'), type: asset[1]! } : null;
    },
  });
  server.on('listening', () => console.log(`TireFlow Control${localMode ? ' local (bot real, inicialmente parado)' : ''}: http://127.0.0.1:${port}`));
  server.on('error', () => { console.error('Não foi possível abrir a porta local do painel.'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    void (async () => {
      try { await local?.shutdown(); server.close(); server.closeAllConnections(); }
      catch { console.error('O bot ainda está encerrando. O painel permanece aberto; confira os logs.'); }
    })();
  });
}

void main().catch(() => { console.error('Painel não iniciado. Confira control.config.json e o build.'); process.exitCode = 1; });
