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

`ALLOW_PRIVATE_TEST_MODE=true` permite os comandos operacionais em qualquer conversa privada
com identidade técnica válida. Não exige lista de usuários, cadastro individual, role,
`isActive`, `OWNER_PHONE` ou `BOSS_PRIVATE_NUMBER` para autorizar comandos. Os dois últimos
continuam sendo configurações de notificações, sem participação na autorização de acesso.

`false`, ausência, valor vazio ou inválido bloqueiam os comandos privados, sem impedir o grupo
oficial válido de funcionar. Alterações entram em vigor depois de reiniciar o serviço; não há
recarga automática. O reinício descarta sessões em memória. Habilitar o privado para qualquer
remetente é a política explícita de testes; não há concessão automática quando a flag está ausente.

No grupo oficial, todos os remetentes identificados podem usar todos os comandos, inclusive
usuários desconhecidos, inativos e de qualquer role. Executar operações não reativa usuários
existentes. Outros grupos continuam bloqueados, preservando apenas `grupo id`, que identifica
a própria conversa. Mensagens sem identidade consistente, do próprio bot, de status, broadcast
ou de origem não suportada são ignoradas antes das operações. IDs `@lid` e `@c.us` identificam
sessões separadas; não se infere equivalência entre eles nem se aceita trocar de conversa para
continuar, confirmar ou cancelar uma operação.
Veja as evidências e limitações em [AUDITORIA_A13.md](AUDITORIA_A13.md).

Para enviar relatórios exclusivamente ao `BOSS_PRIVATE_NUMBER`, configure em cada instalação
o horário e a comissão aplicada ao valor final vendido:

```env
MONTHLY_REPORT_TIME=08:00
MONTHLY_COMMISSION_PERCENT=2
```

No dia 1, o bot envia o relatório operacional do mês anterior sem dados de funcionários ou
comissões. No dia 20, envia separadamente o fechamento das comissões, calculado sobre todas as
vendas do mês-calendário anterior. Pneus novos e cobertos (incluindo os de moto) sem desconto
rendem 2%; com desconto em reais
ou porcentagem, rendem 1%. Isso vale para os preços à vista, a prazo e 10x, sobre o valor final
vendido. Escolher o preço à vista, por si só, não conta como desconto. Baterias e câmaras de ar
(incluindo as de moto) rendem 1%, mesmo sem desconto. Vendas com
desconto também rendem 1%; notas de prefeitura ficam fora da comissão. A regra por categoria
também se aplica às vendas já registradas ao gerar relatórios, sem alterar os registros originais.

Deixe `MONTHLY_REPORT_TIME` vazio para manter os dois envios desativados. Os envios são privados,
não usam o grupo oficial e distribuem pagamentos mistos entre suas formas reais.

O menu oferece dois PDFs separados. A opção 6, `Pneus em estoque atual (PDF)`, ou o comando
`relatorio estoque`, gera a conferência dos pneus ativos com saldo positivo no momento da geração,
sem pedir datas. O PDF agrupa os pneus por aro, mostra a localização quando habilitada e inclui
campos para quantidade contada e diferença. Baterias não entram nessa conferência.

A opção 4, `Relatório mensal (PDF)`, ou o comando `relatorio mensal`, permite escolher o último
mês fechado ou informar um período de até 31 dias no formato `DD/MM/AAAA`. Mostra faturamento,
unidades vendidas, mais vendidos e produtos que zeraram no período, sem a lista do estoque atual.
Ambos exigem confirmação e respondem na própria conversa. A geração manual não altera o controle
do envio automático do dia 1, cujo PDF também contém apenas os dados do período.

O menu também oferece `Relatório de comissões`, disponível pelo comando `relatorio comissoes`.
Ele gera o fechamento do último mês encerrado ou de qualquer período de até 31 dias, sem
interferir no envio automático do dia 20.

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

Para atualizar estoques e preços, preservando os nomes dos produtos existentes e permitindo o
cadastro controlado de produtos novos, use primeiro a simulação:

```powershell
npm run sync:catalog -- data/seed/initial_products.csv
```

Se não houver candidatos, aplique com `--apply`. Quando houver, crie um CSV de decisões. Use
`CREATE` somente para produto realmente novo e `MATCH` para associar a linha da planilha a um
produto existente sem alterar seu nome ou referência:

```csv
csv_reference,csv_description,action,existing_reference,existing_description
205/55 R16,PRODUTO REALMENTE NOVO,CREATE,,
175/70 R14,NOME DA PLANILHA,MATCH,175/70 R14,NOME EXISTENTE NO BANCO
```

Confira com o arquivo de decisões e somente depois aplique:

```powershell
npm run sync:catalog -- data/seed/initial_products.csv --resolution data/seed/congo_catalog_resolution.csv
npm run sync:catalog -- data/seed/initial_products.csv --resolution data/seed/congo_catalog_resolution.csv --apply
```

O comando nunca renomeia, remove ou desativa produtos existentes. Produtos do banco ausentes do
CSV são preservados, assim como IDs, fotos, localizações, vendas e demais históricos. A execução
com `--apply` é bloqueada enquanto existir qualquer candidato sem decisão explícita.

Para importar baterias Moura e Zetta a partir de uma planilha conferida, siga também
[BATTERIES.md](BATTERIES.md).

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

### PDF de estoque no grupo para consulta offline

O agendador existente também envia o PDF de **pneus em estoque atual** ao grupo oficial,
a cada cinco dias (mínimo de 120 horas desde o último envio bem-sucedido), após o horário
já configurado em `DAILY_REPORT_TIME`. Não há nova variável, timer, dependência ou migration.
No primeiro início sem estado, envia após esse horário. Se o bot ficar parado, gera somente
um PDF atual quando voltar a estar apto, sem publicar relatórios atrasados em sequência.

O PDF e a legenda mostram a data/hora da geração. O arquivo precisa ser baixado nos aparelhos
antes da queda para abrir sem internet; os saldos podem mudar após a geração. A consulta manual
pelo menu continua disponível. O relatório diário privado e os backups do banco/fotos continuam
com suas funções e periodicidades próprias.

Depois do envio, tenta fixar a mensagem por sete dias, uma das durações suportadas pelo
[WhatsApp](https://faq.whatsapp.com/294619079641794/?cms_platform=web). A conta do bot precisa
ter permissão de fixação no grupo. Se já houver três fixações ou não for possível confirmar
a nova fixação, preserva as anteriores. Só tenta desafixar o PDF anterior que o próprio bot
registrou, após confirmar a nova fixação e validar a mensagem recuperada como documento
enviado pela própria conta no mesmo grupo. Não remove outros avisos nem apaga mensagens.

O estado fica em `data/stock-report-state.json`, ignorado pelo Git, com data, grupo e ID do PDF
fixado pelo bot. É salvo por arquivo temporário e renomeação. Falha na fixação não causa reenvio
do PDF. Estado ilegível/inválido bloqueia o envio e gera log para inspeção; não apague o arquivo
sem conferir o último envio. Mudança do grupo configurado inicia o controle do novo destino
sem desafixar mensagens do grupo anterior.

Limites: queda após aceite remoto e antes de salvar o estado, perda do arquivo ou timeout
com resultado remoto incerto podem causar reenvio (A14). A17/fuso segue o processo existente.
Falha ao desafixar pode deixar o PDF anterior fixado até expirar. Logs `[STOCK_PDF]` informam
falhas de envio/fixação sem imprimir identificadores. Não há garantia de leitura pelos membros.

Validação em ambiente isolado: 22 testes focados aprovados, suíte completa sequencial com
614 aprovações e zero falhas, typecheck, build e `git diff --check` aprovados. Revisão final
local pelo critério Ponytail. Não foram enviados PDFs nem executadas fixações em WhatsApp real.

### Backup de recuperação

```powershell
npm run backup
```

Por padrão, o backup cria uma pasta datada em `backups`, com snapshot consistente do SQLite,
uploads e manifesto. Quando `BACKUP_ROOT` estiver configurado, a pasta datada será criada nesse
diretório externo. Guarde o `.env` separadamente.

Para instalar backups diários separados, com retenção de 7 cópias, validação da filial e sem
interromper o serviço, siga [DAILY_BACKUPS.md](DAILY_BACKUPS.md).

## 5. Restauração

Siga o [procedimento completo de restauração e recuperação](AUDITORIA_LOTE_4.md#procedimento-operacional).
Suspenda a tarefa de backup e todos os scripts/clientes da filial durante a
manutenção. A origem deve ser uma pasta v1 completa da filial exata, com schema
compatível e sem WAL/journal; incompatibilidades são bloqueadas antes da troca.

Pare apenas o serviço da filial afetada:

```powershell
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Congo
if ($LASTEXITCODE -ne 0) { throw 'Falha ao parar o serviço; não restaure.' }
npm run restore -- 'C:\caminho\do\backup' --confirm
if ($LASTEXITCODE -ne 0) { throw 'Restauração falhou; mantenha parado e siga o procedimento de recuperação.' }
npm run check:runtime
if ($LASTEXITCODE -ne 0) { throw 'Conferência falhou; mantenha o serviço parado.' }
& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Congo
```

Se a restauração for interrompida, mantenha serviço e tarefas parados e execute
`npm run restore -- --recover --confirm` antes do health check. O aplicativo
atualizado bloqueia startup enquanto a restauração estiver incompleta. Não apague
os diretórios `.restore*`: eles preservam banco, sidecars e fotos anteriores.
Após a conferência e o reinício do serviço, reative a tarefa de backup da filial.

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

### Falha ao enviar PDF: `Data passed to getter must include an id property`

O WhatsApp Web pode falhar ao enviar anexos quando o campo privado `__x_id` do modelo de
mídia sobrescreve a identidade da mensagem. A correção está em
`patches-media/whatsapp-web.js+1.34.7.patch` e é aplicada pelo `postinstall`, separadamente
do patch de inicialização em `patches/`. Isso permite atualizar instalações que já receberam
a correção anterior sem apagar `node_modules`.

Após atualizar `package.json` e as pastas `patches/`, `patches-media/` e `patches-bindings/` na instalação da filial, execute `npm run postinstall`
na pasta do projeto e reinicie o bot pelo gerenciador usado na instalação. No NSSM de Monteiro:

```powershell
npm run postinstall
& 'C:\Tools\nssm\win64\nssm.exe' restart TireFlow-Monteiro
```

Confirme que as três etapas informaram `whatsapp-web.js@1.34.7` com sucesso antes de reiniciar.
Somente executar o build não aplica esse patch. Depois, teste o envio pela opção 6 do menu.
Referência: https://github.com/wwebjs/whatsapp-web.js/issues/201922.

### Erro de registro duplicado ao iniciar após reiniciar o servidor

O erro `Failed to add page binding with name onAuthAppStateChangedEvent` pode ocorrer
quando a inicialização e uma navegação interna do WhatsApp registram a mesma função
simultaneamente. O processo encerra e as tentativas seguintes podem repetir a falha.
O patch em `patches-bindings/` compartilha o registro por página e função, espera sua
conclusão e o reutiliza nas navegações seguintes. Falhas de registro continuam sendo
propagadas e permitem uma nova tentativa.

Atualize `package.json`, `scripts/` e as três pastas `patches/`, `patches-media/` e
`patches-bindings/` no servidor. Pare a instância da filial pelo gerenciador usado na
instalação e execute `npm.cmd run postinstall` na pasta do projeto. Confirme que as
três etapas informaram `whatsapp-web.js@1.34.7` com sucesso, execute `npm.cmd run check`
e então inicie a instância. Somente executar o build não aplica a correção.

### Recuperar uma instalação com patches ou dependências incompletos

Atualize os arquivos do projeto, incluindo `package.json`, `package-lock.json`, `scripts/`,
`tests/`, `patches/`, `patches-media/` e `patches-bindings/`. Pare o serviço antes de reparar as dependências.
Se apenas a biblioteca do WhatsApp foi editada, `npm run repair:whatsapp` baixa o pacote
original 1.34.7, confere sua integridade, aplica os três patches em uma pasta temporária e
valida a sintaxe. Só então substitui `Client.js`, `Utils.js` e `Puppeteer.js`, guardando cópia dos anteriores
em `tmp/whatsapp-repair-*/backup`. Ele não altera banco, `.env` ou autenticação.

Se o `check` apresentar arquivos ou tipos ausentes, restaure todas as dependências do lockfile:

```cmd
cd /d C:\sistems\tireflowmtr
npm.cmd ci --ignore-scripts
npm.cmd run postinstall
npx.cmd prisma generate
npm.cmd run check
```

Execute um comando por vez e prossiga somente se terminar sem erro. `npm ci` substitui
`node_modules`; o banco e a sessão, armazenados fora dessa pasta, são preservados.
O `prisma generate` recria o cliente sem modificar o banco. Reinicie o serviço somente
depois do `check` concluir. Não copie `node_modules` de outra máquina.

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
