# Congo e Monteiro no mesmo servidor

Este procedimento coloca a instalação do Congo no mesmo computador que Monteiro sem compartilhar
banco, sessão do WhatsApp, fotos, logs ou serviço. O código pode vir do mesmo repositório Git, mas
as duas instalações devem permanecer em pastas independentes.

## Estrutura obrigatória

```text
C:\sistems\tireflowmtr       -> Monteiro
C:\sistems\tireflowcongo     -> Congo

C:\backups\tireflowmtr_snapshots
C:\backups\tireflowcongo_snapshots
```

Nunca clone Congo dentro de `C:\sistems\tireflowmtr` e não copie o `.env` de Monteiro para Congo.

## 1. Preparar o código do Congo

No servidor que já executa Monteiro, abra o PowerShell como Administrador:

```powershell
Set-Location C:\sistems
git clone https://github.com/EmanoelCariolando/tireflow.git tireflowcongo
Set-Location C:\sistems\tireflowcongo
npm.cmd install
```

Se a pasta `tireflowcongo` já existir, não execute outro `git clone`. Verifique primeiro:

```powershell
Set-Location C:\sistems\tireflowcongo
git status --short
git pull --ff-only origin master
```

## 2. Criar o `.env` exclusivo de Congo

Crie `C:\sistems\tireflowcongo\.env` com os valores reais de Congo. As opções de isolamento devem
ser:

```env
NODE_ENV=production
DATABASE_URL="file:C:/sistems/tireflowcongo/data/tireflow.db"
BRANCH_NAME="ATC PNEUS CONGO"
INVENTORY_LOCATIONS_ENABLED=false
WHATSAPP_SESSION_NAME=tireflow-congo
WHATSAPP_AUTH_DATA_PATH="C:\sistems\tireflowcongo\data\wwebjs_auth"
BACKUP_ROOT="C:\backups\tireflowcongo_snapshots"
```

Grupo oficial, telefones e demais opções também devem ser os de Congo. Não reutilize grupo,
sessão, banco, pasta de autenticação ou backup de Monteiro.

Confira somente as opções sem segredo:

```powershell
Select-String -Path .env -Pattern '^(NODE_ENV|DATABASE_URL|BRANCH_NAME|INVENTORY_LOCATIONS_ENABLED|WHATSAPP_SESSION_NAME|WHATSAPP_AUTH_DATA_PATH|BACKUP_ROOT)='
npx.cmd prisma generate
```

## 3. Migrar os dados operacionais do Congo

Para preservar vendas, entradas, ajustes, usuários, fotos e preços, transfira um backup consistente
do Congo atual. Não use o seed para substituir um banco existente.

No servidor antigo do Congo:

```powershell
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Congo
npm.cmd run backup
```

Mantenha o Congo antigo parado depois do backup. Copie a pasta de backup concluída para o servidor
novo e, em `C:\sistems\tireflowcongo`, restaure:

```powershell
npm.cmd run restore -- 'C:\caminho\do\backup-do-congo' --confirm
npx.cmd prisma migrate deploy
npx.cmd prisma migrate status
```

O backup restaura banco e fotos. A sessão do WhatsApp não faz parte dele. A opção mais segura é
autenticar novamente o WhatsApp do Congo no novo servidor. Se a pasta de sessão for transferida,
copie somente a sessão do Congo, com os dois bots parados, para
`C:\sistems\tireflowcongo\data\wwebjs_auth`.

Nunca deixe a instalação antiga e a nova do Congo executando simultaneamente.

## 4. Conferir o CSV de estoque

O arquivo `data\seed\initial_products.csv` contém 763 produtos. A versão de 22/07/2026 difere da
anterior somente em 34 valores de estoque; referências, descrições e preços são iguais.

Como esse arquivo é datado de 22/07/2026, confirme que ele ainda é a posição oficial antes de
aplicá-lo. Primeiro execute sem alterar o banco:

```powershell
npm.cmd run sync:stocks -- data\seed\initial_products.csv
```

O resultado precisa informar:

```text
Produtos no CSV: 763
Produtos não encontrados: 0
```

Revise a lista `estoque anterior -> estoque novo`. Se o banco já tiver vendas posteriores ao CSV,
não aplique até reconciliar essas movimentações.

Com o serviço Congo parado, backup concluído e conferência aprovada:

```powershell
npm.cmd run sync:stocks -- data\seed\initial_products.csv --apply
npm.cmd run sync:stocks -- data\seed\initial_products.csv
```

A segunda conferência deve mostrar `Estoques a atualizar: 0` e
`Estoques já corretos: 763`. O comando é bloqueado em Monteiro. O único dado operacional alterado
é `products.stock`; o Prisma também atualiza automaticamente o metadado `products.updatedAt`.

## 5. Validar e autenticar

```powershell
npm.cmd run check
npm.cmd run check:runtime
```

Se a sessão não foi transferida, inicie interativamente:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\sistems\tireflowcongo\dist\index.js'
```

Leia o QR code do WhatsApp de Congo, aguarde a aplicação ficar pronta e encerre com `Ctrl+C`.

## 6. Instalar o segundo serviço

Monteiro deve continuar como `TireFlow-Monteiro`. Instale Congo com outro nome e outro diretório:

```powershell
& 'C:\sistems\tireflowcongo\scripts\install-nssm-service.ps1' `
  -ServiceName 'TireFlow-Congo' `
  -ProjectDirectory 'C:\sistems\tireflowcongo' `
  -NodePath 'C:\Program Files\nodejs\node.exe' `
  -NssmPath 'C:\Tools\nssm\win64\nssm.exe'

& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Congo
Get-Service TireFlow-Congo,TireFlow-Monteiro
```

Os dois serviços devem aparecer como `Running`.

## 7. Teste final por filial

No grupo ou conversa autorizada de Congo:

```text
saude
pneu 175 70 13
```

Confirme o nome `ATC PNEUS CONGO` e que a consulta não mostra localização `CG`, `W3` ou `PMAIS`.

Em Monteiro, repita os testes e confirme `ATC PNEUS MONTEIRO` e as localizações habilitadas.
Também confira que cada filial envia notificações e relatório diário somente aos seus próprios
números e grupos.

## Regras para evitar conflito

- um diretório por filial;
- um `.env` por filial;
- um banco e um `DATABASE_URL` por filial;
- uma pasta `WHATSAPP_AUTH_DATA_PATH` por filial;
- um `WHATSAPP_SESSION_NAME` por filial;
- um serviço NSSM por filial;
- uma pasta de backup por filial;
- nunca iniciar duas instalações de Congo ao mesmo tempo;
- nunca executar `seed:products` durante migração ou atualização;
- parar somente o serviço da filial que estiver sendo alterada.
