# TireFlow em produção no Windows

Este guia prepara duas instalações independentes. Congo e Monteiro devem possuir pastas, `.env`, bancos SQLite, sessões do WhatsApp, grupos e uploads próprios.

## 1. Dependências

Instale Node.js LTS, Google Chrome, Git e NSSM. Não instale PM2 nessas máquinas. O serviço é configurado para executar diretamente `node.exe dist\index.js`.

O passo a passo completo de serviço, caminhos absolutos, logs, reinício e comandos está em [NSSM.md](NSSM.md).

## 2. Configuração

Copie `.env.example` para `.env` em cada instalação. No Congo:

```env
NODE_ENV=production
DATABASE_URL="file:./tireflow.db"
BRANCH_NAME="ATC PNEUS CONGO"
WHATSAPP_SESSION_NAME=tireflow-congo
WHATSAPP_AUTH_DATA_PATH="C:\TireFlow\Congo\data\wwebjs_auth"
ALLOW_PRIVATE_TEST_MODE=false
```

`ALLOW_PRIVATE_TEST_MODE` aceita `true` ou `false` também em produção. Use `true` quando quiser testar os comandos em conversa privada; isso não impede a inicialização.

Para enviar no dia 1 o relatório do mês anterior exclusivamente ao `BOSS_PRIVATE_NUMBER`, configure
em cada instalação o horário e a comissão aplicada ao valor final vendido:

```env
MONTHLY_REPORT_TIME=08:00
MONTHLY_COMMISSION_PERCENT=2
```

Deixe `MONTHLY_REPORT_TIME` vazio para manter o relatório mensal desativado. O envio é privado, não
usa o grupo oficial e distribui pagamentos mistos entre suas formas reais.

Em Monteiro, use `BRANCH_NAME="ATC PNEUS MONTEIRO"`, sessão `tireflow-monteiro` e autenticação em `C:\TireFlow\Monteiro\data\wwebjs_auth`. Grupo e números privados também devem pertencer à filial correta.

Somente em Monteiro, habilite a localização física dos pneus:

```env
INVENTORY_LOCATIONS_ENABLED=true
BACKUP_ROOT="C:\backups\tireflowmtr_snapshots"
```

No Congo, mantenha `INVENTORY_LOCATIONS_ENABLED=false`. O CSV de Monteiro pode incluir a coluna
opcional `location` com códigos como `CG`, `W3` e `PMAIS`; no CSV do Congo essa coluna pode ser
omitida.

```csv
reference,description,cash_price,credit_price,stock,location
175/75 R17,PNEU EXEMPLO,499.00,523.95,4,W3
```

O arquivo extraído de Monteiro fica em `data/seed/monteiro_products.csv`. Para importá-lo sem
substituir o CSV padrão:

```powershell
npm run seed:products -- data/seed/monteiro_products.csv
```

Se o banco de Monteiro já possui os produtos e movimentações, não execute o seed novamente.
Sincronize somente as localizações, primeiro em modo de conferência:

```powershell
npm run sync:locations -- data/seed/monteiro_products.csv
```

Se todos os produtos forem encontrados, aplique:

```powershell
npm run sync:locations -- data/seed/monteiro_products.csv --apply
```

Esse comando é bloqueado fora da filial Monteiro e não altera estoque, preços, fotos ou histórico.

Para atualizar somente os estoques de Congo a partir do CSV, primeiro confira:

```powershell
npm run sync:stocks -- data/seed/initial_products.csv
```

O comando é bloqueado fora da filial Congo. Com backup concluído, zero produtos não encontrados e
a lista de diferenças conferida, aplique:

```powershell
npm run sync:stocks -- data/seed/initial_products.csv --apply
```

O único dado operacional alterado é o estoque; o metadado `updatedAt` também é atualizado
automaticamente. Preços, descrições, fotos, localizações, vendas e demais dados são preservados.
Para executar Congo e Monteiro no mesmo servidor, siga
[CONGO_ON_MONTEIRO_SERVER.md](CONGO_ON_MONTEIRO_SERVER.md).

## 3. Banco, build e autenticação

Execute na pasta de cada filial:

```powershell
npm install
npx prisma generate
if (!(Test-Path prisma\tireflow.db)) { New-Item -ItemType File prisma\tireflow.db | Out-Null }
npx prisma migrate deploy
npm run build
npm run check:runtime
```

Inicie uma vez de modo interativo com o caminho absoluto do Node e de `dist\index.js`, autentique o WhatsApp e encerre com `Ctrl+C`. Depois instale o serviço conforme [NSSM.md](NSSM.md).

## 4. Backup

```powershell
npm run backup
```

Por padrão, o backup cria uma pasta datada em `backups`, com snapshot consistente do SQLite,
uploads e manifesto. Quando `BACKUP_ROOT` estiver configurado, a pasta datada será criada nesse
diretório externo. Guarde o `.env` separadamente.

Para instalar backups diários separados, com retenção de 7 cópias, validação da filial e sem
interromper o serviço, siga [DAILY_BACKUPS.md](DAILY_BACKUPS.md).

## 5. Restauração

Pare apenas o serviço da filial afetada:

```powershell
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Congo
npm run restore -- 'C:\caminho\do\backup' --confirm
npm run check:runtime
& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Congo
```

Banco e uploads são restaurados juntos. Troque o nome do serviço para Monteiro quando necessário.

## 6. Atualização

Pare o serviço antes do backup e não execute seed durante uma atualização normal:

```powershell
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Congo
git pull
npm install
npx prisma generate
npm run backup
npx prisma migrate deploy
npm run check
npm run check:runtime
& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Congo
```

O seed é exclusivo para a primeira carga de um banco novo. Não reinicie se backup, build, testes,
diagnóstico ou migration falharem. Para atualizar Monteiro com localizações em um banco existente,
siga [MONTEIRO_UPDATE.md](MONTEIRO_UPDATE.md).

## 7. Checklist por filial

- pasta própria e sem compartilhamento com a outra filial;
- `.env`, banco, grupo, telefones, sessão e uploads exclusivos;
- `BRANCH_NAME` e `WHATSAPP_AUTH_DATA_PATH` conferidos;
- `MONTHLY_REPORT_TIME` e `MONTHLY_COMMISSION_PERCENT` conferidos quando o relatório mensal estiver habilitado;
- migrations, build, testes e `check:runtime` aprovados;
- WhatsApp autenticado interativamente antes de iniciar o serviço;
- venda, entrada, ajuste, preço, foto, addfoto, relatório e backup testados;
- serviço NSSM em início automático e reinício por falha;
- `logs\tireflow-AAAA-MM-DD.log` sendo rotacionado pela aplicação;
- reinício do Windows testado sem iniciar uma segunda instância.
