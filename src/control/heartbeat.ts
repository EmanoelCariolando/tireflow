import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Heartbeat { pid: number; uptimeSeconds: number; whatsappConnected: boolean }

export async function writeHeartbeat(root: string, heartbeat: Heartbeat, now = Date.now()): Promise<void> {
  const destination = path.join(root, 'data', 'control-health.json');
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...heartbeat, timestamp: now }), { mode: 0o600 });
  await rename(temporary, destination);
}

export async function readHeartbeat(root: string, pid: number | null, now = Date.now()): Promise<Heartbeat | null> {
  try {
    const value = JSON.parse(await readFile(path.join(root, 'data', 'control-health.json'), 'utf8')) as Heartbeat & { timestamp: number };
    if (!Number.isSafeInteger(value.pid) || value.pid !== pid || typeof value.whatsappConnected !== 'boolean' ||
      !Number.isFinite(value.uptimeSeconds) || value.uptimeSeconds < 0 ||
      !Number.isFinite(value.timestamp) || value.timestamp > now + 1000 || now - value.timestamp > 45000) return null;
    return { pid: value.pid, uptimeSeconds: value.uptimeSeconds, whatsappConnected: value.whatsappConnected };
  } catch { return null; }
}
