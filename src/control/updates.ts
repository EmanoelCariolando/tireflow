import type { CommandRunner } from './operations.js';
import { runCommand } from './operations.js';
import { ControlError } from './server.js';

export interface UpdateStatus { current: string; latest: string; branch: string; available: boolean; applyBlocked: string }

export async function checkUpdate(root: string, branch: string | null, run: CommandRunner = runCommand): Promise<UpdateStatus> {
  if (!branch) throw new ControlError('Configure e confirme a branch de produção antes de verificar atualizações.');
  const git = (...args: string[]) => run('git', ['-C', root, ...args], 30000);
  const remote = (await git('remote', 'get-url', 'origin')).trim();
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote)) {
    throw new ControlError('A origem precisa ser um repositório GitHub HTTPS sem credenciais no endereço.');
  }
  const currentBranch = (await git('branch', '--show-current')).trim();
  if (currentBranch !== branch) throw new ControlError('A instalação está em outra branch. Atualização bloqueada.');
  const current = (await git('rev-parse', '--verify', 'HEAD')).trim();
  const response = (await git('ls-remote', '--exit-code', '--refs', remote, `refs/heads/${branch}`)).trim().split(/\s+/);
  const latest = response[0];
  if (!/^[a-f0-9]{40}$/.test(current) || !latest || !/^[a-f0-9]{40}$/.test(latest) || response[1] !== `refs/heads/${branch}` || response.length !== 2) {
    throw new ControlError('Não foi possível identificar uma versão remota válida.');
  }
  return { current, latest, branch, available: current !== latest,
    applyBlocked: 'Aplicação aguarda confirmação da estratégia de atualização, migrations e recuperação com o responsável pela instalação.' };
}
