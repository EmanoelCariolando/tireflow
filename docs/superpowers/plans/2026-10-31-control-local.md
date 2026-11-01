# Controle local do bot — plano de implementação

**Objetivo:** permitir iniciar, parar e reiniciar o bot real pelo painel neste PC,
onde `npm run dev` funciona e não há serviço NSSM configurado.

**Decisão de implementação:** comando explícito `npm run control:local`, painel
em `127.0.0.1:4282`. Reutilizar a tela e os endpoints protegidos existentes. Um
adaptador inicia o mesmo Node/tsx e `src/index.ts` do comando de desenvolvimento,
sem shell. O modo NSSM continua sendo o padrão do comando `control`.

O painel controla somente o filho que criou, por referência ao processo, sem
adotar PIDs externos. Encerramento por IPC chama a limpeza já existente do bot;
perda do pai também solicita essa limpeza. Não usar encerramento forçado no
Windows. A proteção de instância existente do banco continua atuando.

**Limites:** não iniciar automaticamente o bot; não executar serviços, migrações,
atualizações ou backups operacionais durante a implementação. No modo local,
backups e consulta de atualização ficam bloqueados. Aviso permanente de que o
bot usa a configuração e os dados reais desta instalação. O laboratório 4281
continua sendo demonstração, claramente identificado.

## Etapas

- [x] Escrever teste que demonstre a ausência do adaptador local, depois cobrir
  início/parada graciosa, reinício com troca de PID, falha de inicialização e
  desconexão do pai usando filhos descartáveis e ambiente isolado.
- [x] Implementar `src/control/localProcess.ts` e a recepção de encerramento IPC
  em módulo pequeno reutilizado por `src/index.ts` e pelos testes.
- [x] Integrar modo explícito em `src/control/index.ts`, script no `package.json`
  e aviso/controles no frontend. Preservar Origin/CSRF e PID do canal QR.
- [x] Conferir modo NSSM, interface local e controles HTTP com processo descartável;
  rodar suíte, typecheck e build; revisão independente e commit somente local.
- [x] Abrir o painel local com o bot parado para o usuário iniciar quando desejar.

## Evidências

Adaptador ausente/indisponível: testes falharam antes da implementação. Cinco
testes do adaptador aprovados, seguidos por 648 testes completos isolados.
Typecheck, build, sintaxe JS e navegador com filho descartável aprovados. Painel
real 4282 disponível com PID nulo e bot parado; backups/atualizações rejeitados.
Revisão independente sem bloqueios confirmados. Ciclo real do SDK não foi
acionado; preservada e documentada a limitação existente de sobreposição entre
inicialização assíncrona e encerramento. Nenhuma migration ou ação NSSM.
