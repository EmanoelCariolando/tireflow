# TireFlow como serviço do Windows com NSSM

O serviço executa o Node.js diretamente. O processo principal é `node.exe dist\index.js`; `npm`, PM2 e shells intermediários não fazem parte do serviço.

## Caminhos validados neste computador

```text
node.exe:            C:\Program Files\nodejs\node.exe
aplicação compilada: C:\Users\Emano\OneDrive\Documents\tireflow\dist\index.js
diretório de trabalho: C:\Users\Emano\OneDrive\Documents\tireflow
```

O `nssm.exe` ainda não foi encontrado neste computador. Extraia o NSSM, por exemplo, em `C:\Tools\nssm\win64\nssm.exe`. Os comandos abaixo usam esse caminho e devem ser executados no PowerShell como Administrador.

## Instalações independentes

Use uma cópia completa e independente do projeto para cada filial:

| Serviço | Projeto | Entrada compilada | Sessão do WhatsApp | Fotos |
| --- | --- | --- | --- | --- |
| `TireFlow-Congo` | `C:\TireFlow\Congo` | `C:\TireFlow\Congo\dist\index.js` | `C:\TireFlow\Congo\data\wwebjs_auth` | `C:\TireFlow\Congo\uploads\products` |
| `TireFlow-Monteiro` | `C:\TireFlow\Monteiro` | `C:\TireFlow\Monteiro\dist\index.js` | `C:\TireFlow\Monteiro\data\wwebjs_auth` | `C:\TireFlow\Monteiro\uploads\products` |

Cada pasta deve conter seu próprio `.env`, banco SQLite, `data`, `logs`, `backups`, `uploads` e sessão. Não use links, unidades de rede ou pastas compartilhadas entre as duas instalações.

Exemplo essencial do `.env` de Congo:

```env
NODE_ENV=production
DATABASE_URL="file:./tireflow.db"
BRANCH_NAME="ATC PNEUS CONGO"
WHATSAPP_SESSION_NAME=tireflow-congo
WHATSAPP_AUTH_DATA_PATH="C:\TireFlow\Congo\data\wwebjs_auth"
LOG_MAX_BYTES=10485760
LOG_RETENTION_DAYS=30
LOG_TO_CONSOLE=true
```

Em Monteiro, altere para:

```env
BRANCH_NAME="ATC PNEUS MONTEIRO"
WHATSAPP_SESSION_NAME=tireflow-monteiro
WHATSAPP_AUTH_DATA_PATH="C:\TireFlow\Monteiro\data\wwebjs_auth"
```

Preencha também grupo, telefones, horário e Chrome conforme o [.env.example](../.env.example). O caminho relativo do SQLite é resolvido pelo Prisma dentro da pasta `prisma` de cada projeto; assim, cada cópia usa seu próprio arquivo `prisma\tireflow.db`.

## Preparação de cada pasta

Na pasta da filial:

```powershell
npm install
npx prisma generate
if (!(Test-Path prisma\tireflow.db)) { New-Item -ItemType File prisma\tireflow.db | Out-Null }
npx prisma migrate deploy
npm run build
npm run check:runtime
```

Antes de instalar o serviço, faça a primeira autenticação do WhatsApp de modo interativo:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\TireFlow\Congo\dist\index.js'
```

Leia o QR code, aguarde o cliente ficar pronto e encerre com `Ctrl+C`. Repita com o caminho de Monteiro na outra instalação. Isso também evita gravar o QR code, que é sensível, no stdout do serviço.

O serviço deve executar com uma conta do Windows que tenha leitura e escrita em toda a pasta da respectiva filial e acesso ao Chrome. Se mudar a conta na aba **Logon** de `services.msc`, use a mesma conta na autenticação inicial do WhatsApp.

## Instalar Congo

Copie o script `scripts\install-nssm-service.ps1` para a instalação ou execute-o a partir do repositório, informando a pasta de Congo:

```powershell
& 'C:\TireFlow\Congo\scripts\install-nssm-service.ps1' `
  -ServiceName 'TireFlow-Congo' `
  -ProjectDirectory 'C:\TireFlow\Congo' `
  -NodePath 'C:\Program Files\nodejs\node.exe' `
  -NssmPath 'C:\Tools\nssm\win64\nssm.exe'
```

## Instalar Monteiro

```powershell
& 'C:\TireFlow\Monteiro\scripts\install-nssm-service.ps1' `
  -ServiceName 'TireFlow-Monteiro' `
  -ProjectDirectory 'C:\TireFlow\Monteiro' `
  -NodePath 'C:\Program Files\nodejs\node.exe' `
  -NssmPath 'C:\Tools\nssm\win64\nssm.exe'
```

O instalador recusa caminhos relativos, verifica `.env`, `dist\index.js` e `dist\runtimeCheck.js`, executa o diagnóstico compilado e só então cria o serviço. Ele configura:

- `NODE_ENV=production` e `LOG_TO_CONSOLE=false` no ambiente do serviço;
- diretório de trabalho igual à pasta da filial;
- inicialização automática com o Windows;
- reinício após falha com atraso de 5 segundos;
- stdout em `logs\nssm-stdout.log` e stderr em `logs\nssm-stderr.log`;
- encerramento por console com até 15 segundos e término da árvore apenas como contingência.

## Operação

Use o nome correspondente à filial:

```powershell
# iniciar
& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Congo

# parar graciosamente
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Congo

# reiniciar
& 'C:\Tools\nssm\win64\nssm.exe' restart TireFlow-Congo

# consultar
& 'C:\Tools\nssm\win64\nssm.exe' status TireFlow-Congo
Get-Service TireFlow-Congo
```

Para Monteiro, substitua somente `TireFlow-Congo` por `TireFlow-Monteiro`.

Remoção segura, sem apagar projeto, `.env`, banco, uploads, logs ou sessão:

```powershell
& 'C:\TireFlow\Congo\scripts\remove-nssm-service.ps1' `
  -ServiceName 'TireFlow-Congo' `
  -NssmPath 'C:\Tools\nssm\win64\nssm.exe' `
  -ConfirmRemoval
```

O equivalente direto é `nssm stop TireFlow-Congo` seguido de `nssm remove TireFlow-Congo confirm`.

## Logs e encerramento

A aplicação cria e gira `logs\tireflow-AAAA-MM-DD.log`: troca de arquivo ao alcançar `LOG_MAX_BYTES` e remove arquivos mais antigos que `LOG_RETENTION_DAYS`. O instalador define `LOG_TO_CONSOLE=false`, portanto o NSSM não recebe uma cópia contínua desses logs e sua rotação fica sob responsabilidade da aplicação.

Os arquivos `nssm-stdout.log` e `nssm-stderr.log` permanecem separados para capturar saídas que ocorram antes da inicialização do logger. Em operação normal devem ficar vazios ou pequenos. Se crescerem, pare o serviço e investigue a falha de inicialização.

Ao parar ou reiniciar, o NSSM envia o evento de console. O TireFlow trata `SIGINT` e `SIGTERM`, para o agendador e o monitor de saúde, encerra o WhatsApp e desconecta o Prisma antes de sair. Em uma falha ou desconexão do WhatsApp, o processo sai com erro e o NSSM o reinicia automaticamente.

Não instale nem execute PM2 nessas instalações: apenas o NSSM deve supervisionar cada processo Node.js.

