import { ControlError, OperationGate, type Action } from './server.js';
import type { BackupStatus, ServiceStatus } from './operations.js';
import type { UpdateStatus } from './updates.js';

interface Overview { version: string | null; whatsappConnected: boolean | null; uptimeSeconds: number | null; lastUpdate: string | null }
interface ControllerDependencies {
  service: { status(): Promise<ServiceStatus>; control(action: 'start' | 'stop' | 'restart'): Promise<{ message: string }> };
  backup(action: 'create' | 'inspect'): Promise<BackupStatus>;
  update(): Promise<UpdateStatus>;
  overview(service: ServiceStatus): Promise<Overview>;
}
const labels = { start: 'Iniciar serviço', stop: 'Parar serviço', restart: 'Reiniciar serviço', backup: 'Criar backup', 'check-update': 'Verificar atualização' };

export function createController(dependencies: ControllerDependencies) {
  const gate = new OperationGate();
  const activities: { timestamp: string; message: string; success: boolean }[] = [];
  let backup: BackupStatus | null = null;
  let update: UpdateStatus | null = null;
  let backupCheckedAt = 0;
  const record = (message: string, success: boolean) => {
    activities.push({ timestamp: new Date().toISOString(), message, success });
    if (activities.length > 20) activities.shift();
  };
  return {
    async status() {
      const service = await dependencies.service.status();
      return { service, ...await dependencies.overview(service), busy: gate.busy, backup, update, activities: [...activities] };
    },
    async refreshBackup() {
      if (gate.busy || Date.now() - backupCheckedAt < 300000) return;
      backupCheckedAt = Date.now();
      await gate.run('verify-backup', async () => {
        try { backup = await dependencies.backup('inspect'); }
        catch { backup = { createdAt: null, verifiedAt: null, verification: 'unavailable', photoFiles: null }; }
      });
    },
    action(action: Action): Promise<{ message: string }> {
      return gate.run(action, async () => {
        try {
          let message: string;
          if (action === 'backup') {
            backup = await dependencies.backup('create');
            if (backup.verification !== 'verified') throw new ControlError('Backup não foi verificado. Solicite inspeção antes de continuar.');
            backupCheckedAt = Date.now();
            message = 'Backup criado e verificado pelo mecanismo existente.';
          } else if (action === 'check-update') {
            update = await dependencies.update();
            message = update.available ? 'Há um commit diferente disponível na branch configurada.' : 'Versão instalada corresponde à branch configurada.';
          } else { message = (await dependencies.service.control(action)).message; }
          record(labels[action], true);
          return { message };
        } catch (error) {
          record(`${labels[action]}: falhou`, false);
          throw error;
        }
      });
    },
  };
}
