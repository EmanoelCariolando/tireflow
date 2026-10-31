import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface LogEntry { timestamp: string; level: 'INFO' | 'WARN' | 'ERROR'; message: string }
const events: [string, string][] = [
  ['[PROCESS] TireFlow instance starting.', 'Processo iniciado'],
  ['[PROCESS] Uncaught exception.', 'Falha não tratada no processo'],
  ['[PROCESS] Unhandled promise rejection.', 'Falha assíncrona no processo'],
  ['[HEALTH] Periodic status.', 'Verificação periódica de saúde'],
  ['[HEALTH] Periodic check failed.', 'Falha na verificação de saúde'],
  ['[WHATSAPP] Disconnected in production;', 'WhatsApp desconectado; reinício solicitado ao NSSM'],
  ['✅ WhatsApp client is ready!', 'WhatsApp conectado'],
  ['⚠️ WhatsApp client disconnected:', 'WhatsApp desconectado'],
  ['❌ Authentication failed:', 'Falha de autenticação do WhatsApp'],
  ['Failed to start TireFlow:', 'Falha ao iniciar o TireFlow'],
  ['[RUNTIME_CHECK] Instalação inválida.', 'Verificação da instalação falhou'],
];

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
        const skipFirst = cursor.offset > 0 && !this.offsets.has(name);
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
          if (!match) continue; // Raw stderr, QR and multiline payloads are never served.
          const message = events.find(([prefix]) => match[3]!.startsWith(prefix))?.[1] ?? 'Evento registrado; detalhes confidenciais ocultos';
          this.entries.push({ timestamp: match[1]!, level: match[2] as LogEntry['level'], message });
        }
        this.offsets.set(name, cursor);
      } catch { /* A rotating or inaccessible file is retried on the next poll. */ }
    }
    this.entries = this.entries.slice(-300);
    return [...this.entries];
  }
}
