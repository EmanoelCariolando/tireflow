import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import env from '../config/env.js';
import { LOG_DIRECTORY } from '../config/appPaths.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let installed = false;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sanitize(value: unknown, key = ''): unknown {
  if (/phone|chatId|author|messageId|rawId|mediaKey|token|secret|password|visibleText|body|content|qr/i.test(key)) {
    return '[REDACTED]';
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === 'string') {
    if (value.length > 2000) return `${value.slice(0, 2000)}…`;
    if (value.length > 500 && /^[A-Za-z0-9+/=\r\n]+$/.test(value)) return '[LARGE_DATA_REDACTED]';
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey),
      ])
    );
  }
  return value;
}

function stringifyArgument(value: unknown): string {
  if (typeof value === 'string') return String(sanitize(value));
  try {
    return JSON.stringify(sanitize(value));
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

function getLogFilePath(now: Date): string {
  const baseName = `tireflow-${dateKey(now)}`;
  let candidate = path.join(LOG_DIRECTORY, `${baseName}.log`);
  let index = 1;
  while (existsSync(candidate) && statSync(candidate).size >= env.logMaxBytes) {
    candidate = path.join(LOG_DIRECTORY, `${baseName}-${index}.log`);
    index += 1;
  }
  return candidate;
}

function removeExpiredLogs(now: Date): void {
  const cutoff = now.getTime() - env.logRetentionDays * 24 * 60 * 60 * 1000;
  for (const filename of readdirSync(LOG_DIRECTORY)) {
    if (!/^tireflow-\d{4}-\d{2}-\d{2}(?:-\d+)?\.log$/.test(filename)) continue;
    const filePath = path.join(LOG_DIRECTORY, filename);
    if (statSync(filePath).mtimeMs < cutoff) rmSync(filePath);
  }
}

function write(level: LogLevel, args: unknown[]): void {
  const now = new Date();
  const message = args.map(stringifyArgument).join(' ');
  const safeBranchName = env.branchName.replace(/[\r\n\0]/g, ' ').slice(0, 80);
  const line = `[${now.toISOString()}] [${level}] [${safeBranchName}] ${message}`;
  const consoleMethod = level === 'ERROR' ? originalConsole.error : level === 'WARN' ? originalConsole.warn : originalConsole.log;
  if (env.logToConsole) consoleMethod(line);
  try {
    appendFileSync(getLogFilePath(now), `${line}\n`, 'utf8');
  } catch (error) {
    originalConsole.error(`[LOGGER] Could not write log file: ${stringifyArgument(error)}`);
  }
}

export function installStructuredLogging(): void {
  if (installed) return;
  mkdirSync(LOG_DIRECTORY, { recursive: true });
  removeExpiredLogs(new Date());
  console.log = (...args: unknown[]) => write('INFO', args);
  console.warn = (...args: unknown[]) => write('WARN', args);
  console.error = (...args: unknown[]) => write('ERROR', args);
  installed = true;
}

export function anonymizeIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}
