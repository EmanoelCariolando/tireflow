import { access, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import env from '../config/env.js';
import { PRODUCT_UPLOAD_DIRECTORY, PROJECT_ROOT } from '../config/appPaths.js';
import { prisma } from '../database/prisma.js';
import { isWhatsAppConnected } from '../whatsapp/client.js';

export interface HealthSnapshot {
  branchName: string;
  whatsappConnected: boolean;
  databaseConnected: boolean;
  uploadsAccessible: boolean;
  uptimeSeconds: number;
  version: string;
}

let monitor: NodeJS.Timeout | null = null;

async function getVersion(): Promise<string> {
  try {
    const content = await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8');
    const parsed = JSON.parse(content) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'desconhecida';
  } catch {
    return 'desconhecida';
  }
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  let databaseConnected = false;
  let uploadsAccessible = false;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    databaseConnected = true;
  } catch (error) {
    console.error('[HEALTH] Database check failed.', error);
  }

  try {
    await mkdir(PRODUCT_UPLOAD_DIRECTORY, { recursive: true });
    await access(PRODUCT_UPLOAD_DIRECTORY, constants.R_OK | constants.W_OK);
    uploadsAccessible = true;
  } catch (error) {
    console.error('[HEALTH] Upload directory check failed.', error);
  }

  return {
    branchName: env.branchName,
    whatsappConnected: isWhatsAppConnected(),
    databaseConnected,
    uploadsAccessible,
    uptimeSeconds: Math.floor(process.uptime()),
    version: await getVersion(),
  };
}

export function formatHealthStatus(health: HealthSnapshot): string {
  const healthy = health.whatsappConnected && health.databaseConnected && health.uploadsAccessible;
  return [
    healthy ? '✅ TireFlow funcionando' : '⚠️ TireFlow requer atenção',
    '',
    `🏢 ${health.branchName}`,
    `📱 WhatsApp: ${health.whatsappConnected ? 'conectado' : 'desconectado'}`,
    `🗄️ Banco: ${health.databaseConnected ? 'conectado' : 'indisponível'}`,
    `📷 Uploads: ${health.uploadsAccessible ? 'acessível' : 'indisponível'}`,
    `⏱️ Ativo há: ${formatUptime(health.uptimeSeconds)}`,
    `🏷️ Versão: ${health.version}`,
  ].join('\n');
}

export function startHealthMonitor(): void {
  if (monitor) return;
  const intervalMs = env.healthLogIntervalMinutes * 60 * 1000;
  monitor = setInterval(() => {
    void getHealthSnapshot().then((health) => {
      console.log('[HEALTH] Periodic status.', {
        whatsapp: health.whatsappConnected,
        database: health.databaseConnected,
        uploads: health.uploadsAccessible,
        uptimeSeconds: health.uptimeSeconds,
        version: health.version,
      });
    }).catch((error: unknown) => console.error('[HEALTH] Periodic check failed.', error));
  }, intervalMs);
}

export function stopHealthMonitor(): void {
  if (!monitor) return;
  clearInterval(monitor);
  monitor = null;
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}
