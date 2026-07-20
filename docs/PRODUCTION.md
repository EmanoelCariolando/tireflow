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

Em Monteiro, use `BRANCH_NAME="ATC PNEUS MONTEIRO"`, sessão `tireflow-monteiro` e autenticação em `C:\TireFlow\Monteiro\data\wwebjs_auth`. Grupo e números privados também devem pertencer à filial correta.

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

O backup cria uma pasta datada em `backups`, com snapshot consistente do SQLite, uploads e manifesto. Guarde o `.env` separadamente e copie os backups para outro disco protegido.

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

```powershell
npm run backup
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Congo
git pull
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed:products
npm run check
npm run check:runtime
& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Congo
```

Não reinicie se build, testes, diagnóstico ou migration falharem.

## 7. Checklist por filial

- pasta própria e sem compartilhamento com a outra filial;
- `.env`, banco, grupo, telefones, sessão e uploads exclusivos;
- `BRANCH_NAME` e `WHATSAPP_AUTH_DATA_PATH` conferidos;
- migrations, build, testes e `check:runtime` aprovados;
- WhatsApp autenticado interativamente antes de iniciar o serviço;
- venda, entrada, ajuste, preço, foto, addfoto, relatório e backup testados;
- serviço NSSM em início automático e reinício por falha;
- `logs\tireflow-AAAA-MM-DD.log` sendo rotacionado pela aplicação;
- reinício do Windows testado sem iniciar uma segunda instância.
