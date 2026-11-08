import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ControlConfig } from './config.js';
import { ControlError } from './server.js';

export type CommandRunner = (file: string, args: string[], timeout?: number) => Promise<string>;
const executeFile = promisify(execFile);
export const runCommand: CommandRunner = async (file, args, timeout = 75000) => {
  const { stdout } = await executeFile(file, args, { timeout, maxBuffer: 262144, windowsHide: true, shell: false, encoding: 'utf8' });
  return stdout;
};

export interface ServiceStatus {
  state: 'online' | 'offline' | 'starting' | 'stopping' | 'error' | 'unavailable';
  pid: number | null;
  uptimeSeconds: number | null;
  canControl: boolean;
  message?: string;
}

export class ServiceController {
  constructor(private root: string, private config: ControlConfig, private run: CommandRunner = runCommand) {}

  private async invoke(action: 'status' | 'start' | 'stop' | 'restart'): Promise<ServiceStatus> {
    if (!this.config.serviceName) throw new ControlError('Configure o serviço NSSM em control.config.json.');
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const output = await this.run(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.root, 'scripts', 'control-service.ps1'),
      '-Action', action, '-ServiceName', this.config.serviceName, '-ProjectDirectory', this.root,
      '-NssmPath', this.config.nssmPath, '-NodePath', process.execPath,
    ]);
    const value = JSON.parse(output.trim()) as ServiceStatus;
    if (!['online', 'offline', 'starting', 'stopping', 'error', 'unavailable'].includes(value.state) ||
      typeof value.canControl !== 'boolean' ||
      (value.pid !== null && (!Number.isSafeInteger(value.pid) || value.pid <= 0)) ||
      (value.uptimeSeconds !== null && (!Number.isFinite(value.uptimeSeconds) || value.uptimeSeconds < 0))) throw new Error('Invalid service response');
    return { state: value.state, canControl: value.canControl, pid: value.pid, uptimeSeconds: value.uptimeSeconds };
  }

  async status(): Promise<ServiceStatus> {
    try { return await this.invoke('status'); }
    catch {
      return { state: 'unavailable', pid: null, uptimeSeconds: null, canControl: false,
        message: this.config.serviceName ? 'Não foi possível validar o serviço NSSM e suas permissões.' : 'Configure o serviço NSSM em control.config.json.' };
    }
  }

  async control(action: 'start' | 'stop' | 'restart'): Promise<{ message: string }> {
    if (!this.config.serviceName) throw new ControlError('Configure o serviço NSSM em control.config.json.');
    const before = await this.status();
    if (!before.canControl) throw new ControlError('Sem permissão administrativa ou instalação NSSM não validada.');
    if (!['online', 'offline'].includes(before.state)) throw new ControlError('O serviço está em transição ou indisponível. Aguarde e confira seu estado.');
    if ((action === 'start' && before.state !== 'offline') || (action === 'stop' && before.state !== 'online')) {
      throw new ControlError('O estado do serviço mudou. Atualize o painel antes de continuar.');
    }
    const result = await this.invoke(action);
    const expected = action === 'stop' ? 'offline' : 'online';
    if (result.state !== expected) throw new ControlError('O serviço não atingiu o estado esperado. Confira os logs antes de tentar novamente.');
    const verified = await this.status();
    if (verified.state !== expected) throw new ControlError('O serviço não manteve o estado esperado. Confira os logs.');
    return { message: action === 'stop' ? 'Serviço parado e estado conferido.' : 'Comando concluído; processo ativo. Confira a conexão WhatsApp no painel.' };
  }
}

export interface BackupStatus {
  createdAt: string | null;
  verifiedAt: string | null;
  verification: 'verified' | 'failed' | 'unavailable';
  photoFiles: number | null;
}

export async function backupOperation(root: string, action: 'inspect' | 'create', run: CommandRunner = runCommand): Promise<BackupStatus> {
  // Killing a creator would bypass the existing backup lock's finally block.
  const output = await run(process.execPath, [path.join(root, 'dist', 'control', 'backupTask.js'), action], action === 'create' ? 0 : 120000);
  const value = JSON.parse(output.trim()) as BackupStatus;
  if (!['verified', 'failed', 'unavailable'].includes(value.verification) ||
    ![value.createdAt, value.verifiedAt].every(date => date === null || (typeof date === 'string' && Number.isFinite(Date.parse(date)))) ||
    (value.photoFiles !== null && (!Number.isSafeInteger(value.photoFiles) || value.photoFiles < 0))) throw new Error('Invalid backup response');
  return { createdAt: value.createdAt, verifiedAt: value.verifiedAt, verification: value.verification, photoFiles: value.photoFiles };
}
