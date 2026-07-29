# Backups diários automáticos

O TireFlow pode registrar uma tarefa diária por filial no Agendador de Tarefas do Windows. Cada
tarefa:

- confirma o `BRANCH_NAME` esperado antes de agir;
- exige `NODE_ENV=production`;
- exige `BACKUP_ROOT` absoluto e fora do projeto;
- cria uma cópia consistente do SQLite com o bot funcionando;
- executa diretamente o backup compilado pelo Node.js;
- valida a pasta e o manifesto gerados;
- nunca para, inicia ou reinicia o serviço NSSM;
- impede duas execuções simultâneas da mesma tarefa;
- registra o resultado em `logs\scheduled-backup.log`.

O backup continua criando pastas datadas. `BACKUP_RETENTION=7` mantém as 7 cópias mais recentes
de cada filial e remove apenas as mais antigas.

## 1. Pré-requisitos

Antes de instalar, cada projeto deve estar atualizado e compilado:

```powershell
npm.cmd install --include=dev
npx.cmd prisma generate
npm.cmd run build
npm.cmd run check:runtime
```

Confira o `.env` de Congo:

```env
NODE_ENV=production
BRANCH_NAME="ATC PNEUS CONGO"
BACKUP_ROOT="C:\backups\tireflowcongo_snapshots"
BACKUP_RETENTION=7
```

Confira o `.env` de Monteiro:

```env
NODE_ENV=production
BRANCH_NAME="ATC PNEUS MONTEIRO"
BACKUP_ROOT="C:\backups\tireflowmtr_snapshots"
BACKUP_RETENTION=7
```

Os serviços `TireFlow-Congo` e `TireFlow-Monteiro` precisam existir. Abra o PowerShell ou Prompt de
Comando como Administrador para instalar as tarefas.

## 2. Instalar Congo às 02:00

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\sistems\tireflowcongo\scripts\install-daily-backup-task.ps1" -TaskName "TireFlow-Backup-Congo" -ServiceName "TireFlow-Congo" -ProjectDirectory "C:\sistems\tireflowcongo" -ExpectedBranchName "ATC PNEUS CONGO" -DailyAt "02:00"
```

## 3. Instalar Monteiro às 02:30

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\sistems\tireflowmtr\scripts\install-daily-backup-task.ps1" -TaskName "TireFlow-Backup-Monteiro" -ServiceName "TireFlow-Monteiro" -ProjectDirectory "C:\sistems\tireflowmtr" -ExpectedBranchName "ATC PNEUS MONTEIRO" -DailyAt "02:30"
```

As tarefas usam a conta interna `SYSTEM`, privilégios elevados e início assim que possível quando o
servidor estava desligado no horário programado.

## 4. Testar uma tarefa

Teste primeiro Congo:

```powershell
Start-ScheduledTask -TaskName "TireFlow-Backup-Congo"
Get-ScheduledTaskInfo -TaskName "TireFlow-Backup-Congo"
Get-Content "C:\sistems\tireflowcongo\logs\scheduled-backup.log" -Tail 50
Get-Service TireFlow-Congo,TireFlow-Monteiro
```

Depois que a tarefa terminar, `LastTaskResult` deve ser `0`, o log deve terminar com
`Rotina de backup agendado finalizada com sucesso` e os serviços continuarão no estado em que já
estavam.

Repita com Monteiro:

```powershell
Start-ScheduledTask -TaskName "TireFlow-Backup-Monteiro"
Get-ScheduledTaskInfo -TaskName "TireFlow-Backup-Monteiro"
Get-Content "C:\sistems\tireflowmtr\logs\scheduled-backup.log" -Tail 50
Get-Service TireFlow-Congo,TireFlow-Monteiro
```

Também confirme a nova pasta datada dentro do `BACKUP_ROOT` correspondente. O bot continua
respondendo durante o backup; não existe pausa nem reinicialização do serviço.

O banco é copiado com o recurso `VACUUM INTO` do próprio SQLite. Isso gera uma imagem consistente do
banco enquanto ele está aberto. As fotos são copiadas em seguida; se uma foto estiver sendo alterada
exatamente naquele instante e não puder ser copiada, a rotina falha sem apagar backups anteriores e
tenta novamente apenas na execução seguinte.

As tarefas aparecem em **Agendador de Tarefas > Biblioteca do Agendador de Tarefas**.

## 5. Alterar o horário

Execute novamente o instalador da filial com o novo horário e acrescente `-Replace`. Exemplo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\sistems\tireflowcongo\scripts\install-daily-backup-task.ps1" -TaskName "TireFlow-Backup-Congo" -ServiceName "TireFlow-Congo" -ProjectDirectory "C:\sistems\tireflowcongo" -ExpectedBranchName "ATC PNEUS CONGO" -DailyAt "01:30" -Replace
```

Sem `-Replace`, o instalador recusa substituir uma tarefa existente.

## 6. Remover uma tarefa

Remover a tarefa não apaga nenhum backup, banco, foto, log, `.env`, sessão ou serviço NSSM.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\sistems\tireflowcongo\scripts\remove-daily-backup-task.ps1" -TaskName "TireFlow-Backup-Congo" -ConfirmRemoval

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\sistems\tireflowmtr\scripts\remove-daily-backup-task.ps1" -TaskName "TireFlow-Backup-Monteiro" -ConfirmRemoval
```

## 7. Proteção fora do servidor

As cópias diárias no mesmo disco protegem contra bugs e erros operacionais, mas não contra perda do
disco, furto ou ransomware. Mantenha pelo menos uma cópia semanal de cada filial em outro disco ou
destino protegido e teste uma restauração periodicamente.
