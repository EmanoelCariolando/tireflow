import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface LogEntry { timestamp: string; level: 'INFO' | 'WARN' | 'ERROR'; message: string; file: string }
const hiddenDetails = 'Evento registrado; detalhes confidenciais ocultos';
const operationalPrefix = /^\[(?:PROCESS|WHATSAPP|HEALTH|STARTUP|STARTUP_RECOVERY|RUNTIME_CHECK|NOTIFICATION|REPORT|MONTHLY_REPORT|PENDING_SALE|BACKUP|LOGGER|PNEU|BATTERY|WA PAGE (?:error|warn|info|log|debug))\]\s*/i;
const plainMessages = new Set([
  '✅ WhatsApp authentication successful.', '✅ WhatsApp client is ready!',
  '🤖 TireFlow bot is now listening for messages.', 'Bot is running. Press Ctrl+C to stop.',
  '[PROCESS] TireFlow instance starting.', '[PROCESS] Uncaught exception.',
  '[PROCESS] Unhandled promise rejection.', '[PROCESS] Ignoring transient WhatsApp Web navigation rejection.',
  '[HEALTH] Periodic status.', '[HEALTH] Periodic check failed.',
  '[HEALTH] Database check failed.', '[HEALTH] Upload directory check failed.',
  '[WHATSAPP] Disconnected in production; exiting for service restart.',
  '[WHATSAPP] Authentication required. Stop the service and pair in an interactive terminal.',
  '[WHATSAPP] Authentication required. Open the local control panel or pair in an interactive terminal.',
  '[STARTUP] Configuration, migrations, database integrity and uploads directory validated.',
  '[RUNTIME_CHECK] Instalação inválida.', '[RUNTIME_CHECK] Instalação pronta para iniciar o WhatsApp.',
  '[REPORT] Daily report scheduler disabled. DAILY_REPORT_TIME is not configured.',
  '[MONTHLY_REPORT] Scheduler disabled. MONTHLY_REPORT_TIME is not configured.',
  '🚀 Starting WhatsApp client...',
]);
const operationalTemplates = [
  /^Loading: (?:100|\d{1,2})% - WhatsApp$/,
  /^\[NOTIFICATION\] Private notification targets warmed up \(\d{1,3}\/\d{1,3}\) in \d{1,9}ms\.$/,
  /^\[REPORT\] Daily report scheduler enabled for (?:[01]\d|2[0-3]):[0-5]\d\.$/,
  /^\[REPORT\] Daily report sent for \d{4}-\d{2}-\d{2}\.$/,
  /^\[PENDING_SALE\] Reminders enabled at (?:[01]\d|2[0-3]):[0-5]\d and (?:[01]\d|2[0-3]):[0-5]\d\.$/,
  /^\[PNEU\] \[IDENTIFICADOR OCULTO\] -> \d{3}\/\d{2} R\d{2} \(\d{1,5} produtos\) queryMs=\d{1,9}(?: replyMs=\d{1,9} totalMs=\d{1,9})?$/,
  /^\[WHATSAPP\] Startup page\/network failure\. Retrying in \d{1,5} seconds without removing the saved session\.$/,
];
const preloadMessages = new Set([
  'The resource [URL OCULTA] was preloaded but not used.',
  "The resource [URL OCULTA] was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.",
]);

function sanitizeMessage(raw: string): string {
  let message = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
  if (!message) return hiddenDetails;
  if (message.startsWith('[MESSAGE]')) {
    return message.startsWith('[MESSAGE] Incoming authorized message.')
      ? '[MESSAGE] Incoming authorized message. [detalhes ocultos]' : '[MESSAGE] Detalhes da mensagem ocultos';
  }
  if (/^(?:Failed to start TireFlow:|❌ Authentication failed:|⚠️ WhatsApp client disconnected:)/.test(message)) {
    return message.slice(0, message.indexOf(':') + 1) + ' [detalhes ocultos]';
  }
  const protectedMessage = (message.match(operationalPrefix)?.[0] ?? '') + hiddenDetails;
  // Browser console text can include private WhatsApp content; a tag alone is not a safe boundary.
  const browserMessage = /^(\[WA PAGE (?:error|warn|info|log|debug)\])\s*(.*)$/i.exec(message);
  if (browserMessage) {
    const body = browserMessage[2]!;
    if (body === "The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.") return message;
    const httpFailure = /^Failed to load resource: the server responded with a status of ([1-5]\d{2})(?: \([^)]*\))?$/.exec(body);
    if (httpFailure) return `${browserMessage[1]} Failed to load resource: the server responded with a status of ${httpFailure[1]}${body.endsWith(' ()') ? ' ()' : ' [detalhes ocultos]'}`;
    const preload = body.replace(/^The resource \S+ was preloaded/, 'The resource [URL OCULTA] was preloaded');
    return preloadMessages.has(preload) ? `${browserMessage[1]} ${preload}` : protectedMessage;
  }
  const payload = message.search(/\{|\[(?:\s*["{\d-]|true\b|false\b|null\b|\])/);
  if (payload >= 0) message = message.slice(0, payload).trimEnd();
  message = message.replace(/\d+(?:-\d+)?@(?:c\.us|g\.us|lid|s\.whatsapp\.net)/gi, '[IDENTIFICADOR OCULTO]');
  return plainMessages.has(message) || operationalTemplates.some(pattern => pattern.test(message))
    ? message + (payload >= 0 ? ' [detalhes ocultos]' : '') : protectedMessage;
}

export class LogReader {
  private offsets = new Map<string, { offset: number; identity: string; pending: string }>();
  private entries: LogEntry[] = [];
  private reading: Promise<LogEntry[]> | null = null;
  constructor(private directory: string) {}

  read(): Promise<LogEntry[]> {
    if (!this.reading) this.reading = this.scan().finally(() => { this.reading = null; });
    return this.reading;
  }

  private async scan(): Promise<LogEntry[]> {
    let names: string[];
    try { names = (await readdir(this.directory)).filter(name => /^tireflow-\d{4}-\d{2}-\d{2}(?:-\d+)?\.log$/.test(name)); }
    catch { return [...this.entries]; }
    names.sort((a, b) => a.slice(9, 19).localeCompare(b.slice(9, 19)) ||
      Number(a.match(/^tireflow-\d{4}-\d{2}-\d{2}-(\d+)\.log$/)?.[1] ?? 0) -
      Number(b.match(/^tireflow-\d{4}-\d{2}-\d{2}-(\d+)\.log$/)?.[1] ?? 0));
    const selected = names.slice(-3);
    for (const name of this.offsets.keys()) if (!selected.includes(name)) this.offsets.delete(name);
    for (const name of selected) {
      try {
        const filename = path.join(this.directory, name);
        const info = await lstat(filename);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) continue;
        const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
        let cursor = this.offsets.get(name);
        if (!cursor || cursor.identity !== identity || info.size < cursor.offset) {
          cursor = { offset: Math.max(0, info.size - 32768), identity, pending: '' };
        }
        let skipFirst = cursor.offset > 0 && !this.offsets.has(name);
        if (info.size - cursor.offset > 32768) {
          cursor = { offset: info.size - 32768, identity, pending: '' };
          skipFirst = true;
        }
        const bytes = Buffer.alloc(Math.min(32768, Math.max(0, info.size - cursor.offset)));
        const handle = await open(filename, 'r');
        let count: number;
        try { count = (await handle.read(bytes, 0, bytes.length, cursor.offset)).bytesRead; }
        finally { await handle.close(); }
        const lines = (cursor.pending + bytes.subarray(0, count).toString('utf8')).split('\n');
        cursor.offset += count;
        cursor.pending = (lines.pop() ?? '').slice(-8192);
        if (skipFirst) lines.shift();
        for (const line of lines) {
          const match = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] \[(INFO|WARN|ERROR)\] \[[^\]\r\n]*\] (.*)$/.exec(line);
          if (!match || !Number.isFinite(Date.parse(match[1]!))) continue;
          this.entries.push({ timestamp: match[1]!, level: match[2] as LogEntry['level'], message: sanitizeMessage(match[3]!), file: name });
        }
        this.offsets.set(name, cursor);
      } catch { /* A rotating or inaccessible file is retried on the next poll. */ }
    }
    this.entries = this.entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-300);
    return [...this.entries];
  }
}
