# TireFlow Control no Windows

Painel independente do bot em `http://127.0.0.1:4280`. Usa o Node já instalado e
o NSSM existente. Não abre acesso pela rede e não precisa de framework web.

## Estado desta entrega

- Status do processo NSSM/Node, uptime, versão/commit e heartbeat do WhatsApp.
- Iniciar, parar e reiniciar o serviço configurado, com confirmação de interrupção,
  validação da instalação, permissão de administrador e conferência do processo.
- Backup pelo mecanismo existente; inspeção periódica do último backup em cópia
  temporária, sem abrir o banco operacional. Verificação de SQLite, fotos e schema.
- Logs incrementais, somente leitura, filtros e limite de 300 eventos.
- Consulta manual da branch GitHub HTTPS; nenhuma atualização automática.

**A aplicação de atualizações está bloqueada nesta entrega.** Nome do serviço,
branch de produção, política de migrations e estratégia de recuperação ainda
precisam ser confirmados pelo responsável. O painel não instala dependências,
altera Git, migra banco ou restaura dados. Não existe endpoint para contornar esse
bloqueio. A etapa de aplicação e recuperação de código permanece pendente.

## Preparação inicial

Na instalação correta, depois de revisar e integrar os commits locais:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
Copy-Item -LiteralPath control.config.example.json -Destination control.config.json
```

Edite `control.config.json` localmente, informando os valores reais. O arquivo é
ignorado pelo Git. Exemplo de formato, **substitua os nomes** antes de usar:

```json
{
  "port": 4280,
  "serviceName": "TireFlow-Monteiro",
  "nssmPath": "C:\\Tools\\nssm\\win64\\nssm.exe",
  "productionBranch": "BRANCH_CONFIRMADA_PELO_RESPONSAVEL"
}
```

Pode deixar `serviceName` e `productionBranch` como `null` para abrir o painel sem
configurar os controles. A porta deve estar entre 1024 e 65535. O bind é sempre
`127.0.0.1`; não há opção de endereço externo. Não adicione regra de firewall,
proxy público, túnel ou acesso remoto. Use uma porta por instalação/filial.

Para conferir manualmente o painel após instalação:

```powershell
npm.cmd run control
```

Abra exatamente `http://127.0.0.1:4280`; `localhost`, endereços de rede e outros
nomes são rejeitados. Sem elevação administrativa os controles Windows ficam
indisponíveis. O painel valida o executável NSSM, diretório, Node e entrada do bot
antes de controlar o serviço. O Node usado no painel deve ser o mesmo do serviço.
Não reinstale nem altere o serviço do bot para acomodar o painel.

## Inicialização automática independente

Configuração única, em PowerShell como Administrador. Revise os caminhos e nomes
de filial antes de executar; estes comandos **instalam e iniciam o painel**, sem
parar ou reiniciar o bot. Confirme a conta Windows e seus direitos com o
administrador da instalação. Os comandos abaixo usam a conta padrão do NSSM
(LocalSystem), que tem privilégios amplos; a instalação pode optar por uma conta
administrativa dedicada com acesso somente à instalação e aos backups.

```powershell
$panelNssm = 'C:\Tools\nssm\win64\nssm.exe'
$panelRoot = 'C:\TireFlow\Monteiro'
$panelNode = 'C:\Program Files\nodejs\node.exe'
$panelService = 'TireFlow-Control-Monteiro'

New-Item -ItemType Directory -Path (Join-Path $panelRoot 'logs') -Force | Out-Null
& $panelNssm install $panelService $panelNode
& $panelNssm set $panelService AppDirectory $panelRoot
& $panelNssm set $panelService AppParameters ('"{0}"' -f (Join-Path $panelRoot 'dist\control\index.js'))
& $panelNssm set $panelService AppStdout (Join-Path $panelRoot 'logs\control-stdout.log')
& $panelNssm set $panelService AppStderr (Join-Path $panelRoot 'logs\control-stderr.log')
& $panelNssm set $panelService AppRotateFiles 1
& $panelNssm set $panelService AppRotateOnline 1
& $panelNssm set $panelService AppRotateBytes 1048576
& $panelNssm set $panelService AppExit Default Restart
& $panelNssm set $panelService AppRestartDelay 15000
& $panelNssm set $panelService Start SERVICE_DELAYED_AUTO_START
& $panelNssm set $panelService DisplayName 'TireFlow Control - Monteiro'
& $panelNssm start $panelService
```

Não configure dependência do painel no serviço do bot. Com o serviço do bot
parado, o painel mantém seu próprio Node e continua disponível no navegador.
Não use `scripts/install-nssm-service.ps1` para instalar o painel: aquele script
é exclusivo do bot e fixa `dist/index.js`.

## Atalho na área de trabalho

Execute uma vez na conta do usuário que utilizará o navegador. Ajuste a porta
caso tenha sido alterada na configuração:

```powershell
$panelDesktop = [Environment]::GetFolderPath('Desktop')
$panelShell = New-Object -ComObject WScript.Shell
$panelShortcut = $panelShell.CreateShortcut((Join-Path $panelDesktop 'TireFlow Control.url'))
$panelShortcut.TargetPath = 'http://127.0.0.1:4280'
$panelShortcut.Save()
```

Após a instalação automática, o atalho abre o painel sem terminal. Ele não inicia
o bot nem concede elevação ao navegador.

## Interpretação dos estados

`Online` exige encontrar o processo Node filho do NSSM com a entrada esperada;
o wrapper NSSM sozinho não basta. `Iniciando` e `Parando` são transições do
serviço; problemas de consulta ou permissão aparecem como `Não disponível`.
O uptime corresponde ao processo Node do bot, não ao painel.

WhatsApp usa um heartbeat mínimo publicado a cada 15 segundos pelo monitor
existente. Dados vencidos há mais de 45 segundos, PID diferente e serviço parado
não são anunciados como conectados. O bot só publica depois de chegar ao monitor;
antes disso o status é `Não disponível`. Não há QR ou sessão no painel.

A versão é o `package.json`, acompanhada pelo commit quando houver Git. A data da
última instalação fica `Não disponível`: a instalação existente não registra essa
data e a data de um commit não comprova quando foi instalado.

A primeira consulta de backup e as seguintes, espaçadas em pelo menos cinco
minutos, verificam a cópia mais recente. A operação ocupa o bloqueio administrativo
e seu progresso é indicado como conferência. Backup criado pelo painel também
passa pelo validador existente. Falhas, ausência de configuração e indisponibilidade
do worker são estados explícitos; não há restauração pelo navegador.

Os logs são eventos estruturados da aplicação, com horário, nível e descrição
predefinida. Mensagens livres, dados de clientes, detalhes de erros, stdout/stderr
bruto e QR são ocultados. O leitor consulta os últimos três arquivos rotativos,
lê até 32 KiB novos por arquivo por consulta e mantém até 300 eventos. O filtro
age sobre esse conjunto; não é uma busca em todo o histórico. Atividades
administrativas ficam em memória e são limpas ao encerrar o painel.

A criação de backup não tem cancelamento nem timeout forçado: o worker precisa
liberar os bloqueios persistentes pelo próprio fluxo existente. Se uma criação
não terminar, o painel continua acessível e mantém os demais comandos bloqueados;
solicite inspeção local sem iniciar outro backup. A conferência em cópia temporária
tem limite de dois minutos, pois não adquire o bloqueio de criação.

## Limites e validação

O bloqueio serializa controles, backups e consulta de atualização deste painel.
Os bloqueios de banco e backup já existentes continuam atuando nos workers.
Operações externas por terminal, NSSM ou agendador precisam ser coordenadas com
o responsável; o painel não assume controle desses operadores.

As ações HTTP exigem Host e Origin exatos, JSON limitado e token CSRF aleatório
por processo. O servidor não recebe comandos, caminhos nem nomes de serviço do
navegador. O diretório da instalação e a configuração devem continuar protegidos
pelas permissões Windows. Usuários e processos locais autorizados a abrir o painel
podem realizar suas ações administrativas; não há autenticação multiusuário.

Desenvolvimento e testes não executam parada, reinício, atualização ou criação de
backup na instalação operacional. Testes usam o runner isolado já existente e
adaptadores controlados para Windows/Git. A conta Windows, o serviço instalado e
o ciclo operacional real precisam ser homologados no servidor pelo responsável.
