import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import type { ServiceStatus } from './operations.js';
import { ControlError } from './server.js';

export class LocalProcessController {
  private child: ChildProcess | null = null;
  private state: ServiceStatus['state'] = 'offline';
  private startedAt: number | null = null;
  private shuttingDown = false;
  private message = 'Nenhum bot iniciado por este painel. Iniciar executa o mesmo bot de npm run dev.';

  constructor(private root: string, private launch: (file: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {}

  async status(): Promise<ServiceStatus> {
    return { state: this.state, pid: this.child?.pid ?? null,
      uptimeSeconds: this.startedAt === null ? null : Math.floor((Date.now() - this.startedAt) / 1000),
      canControl: !this.shuttingDown, message: this.message };
  }

  private async start(): Promise<void> {
    if (this.shuttingDown) throw new ControlError('O painel está encerrando. Abra-o novamente antes de iniciar o bot.');
    this.state = 'starting';
    this.message = 'Iniciando o bot local. Aguarde os logs e a conexão WhatsApp.';
    try {
      const child = this.launch(process.execPath, ['--import', 'tsx', path.join(this.root, 'src', 'index.ts')], {
        cwd: this.root, windowsHide: true, shell: false, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, TIREFLOW_CONTROL_LOCAL_CHILD: '1' },
      });
      this.child = child;
      const clear = (message: string) => {
        if (this.child !== child) return;
        this.child = null; this.startedAt = null; this.state = 'offline'; this.message = message;
      };
      child.once('error', () => clear('Não foi possível iniciar o bot local. Confira o terminal do painel.'));
      child.once('exit', code => clear(code === 0 ? 'Bot local encerrado.' : 'O bot local encerrou com falha. Confira os logs e o terminal do painel.'));
      await once(child, 'spawn');
      if (this.child !== child) throw new Error('Local process exited');
      this.startedAt = Date.now();
      this.state = 'online';
      this.message = 'Processo local ativo. Aguarde a confirmação do WhatsApp nos logs; Online indica o processo, não a conexão.';
    } catch {
      this.state = 'offline';
      this.message = 'Não foi possível iniciar o bot local. Confira o terminal do painel.';
      throw new ControlError('Não foi possível iniciar o bot local. Confira o terminal do painel.');
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.state = 'stopping';
    this.message = 'Aguardando o bot encerrar o WhatsApp e liberar o banco.';
    await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        child.off('exit', finish);
        reject(new ControlError('O encerramento ainda não terminou. Confira os logs; o processo não foi forçado.'));
      }, 45000);
      child.once('exit', finish);
      // Disconnect also remains observable if the bot is still loading its modules.
      if (child.connected) child.disconnect();
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.close();
  }

  async control(action: 'start' | 'stop' | 'restart'): Promise<{ message: string }> {
    if (this.shuttingDown) throw new ControlError('O painel está encerrando. Abra-o novamente antes de iniciar o bot.');
    if (!['online', 'offline'].includes(this.state) ||
      (action === 'start' && this.state !== 'offline') || (action === 'stop' && this.state !== 'online')) {
      throw new ControlError('O estado do bot local mudou. Atualize o painel antes de continuar.');
    }
    if (action === 'stop' || action === 'restart') await this.close();
    if (action === 'start' || action === 'restart') await this.start();
    return { message: action === 'stop' ? 'Bot local encerrado com limpeza concluída.' : 'Processo local iniciado. Aguarde a conexão WhatsApp nos logs ou escaneie o QR quando solicitado.' };
  }
}
