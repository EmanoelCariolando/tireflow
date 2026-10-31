# Validação do TireFlow Control — 31/10/2026

Base: `06b6565`. Trabalho na branch `feat/local-control-panel`, sem push, merge ou
deploy. A árvore estava limpa antes do início.

## Evidências

- Suíte completa pelo runner isolado existente: **632 testes passaram**, zero
  falhas, skips ou cancelamentos. Inclui 14 testes do painel.
- `npm.cmd run typecheck` e `npm.cmd run build`: aprovados.
- `node --check src/control/public/app.js`: aprovado.
- Parser Windows PowerShell 5.1: adaptador aprovado sem executar seu corpo.
- Chrome headless, desktop 1440 px e celular 390 px: carregamento, filtros,
  ausência de overflow horizontal e ausência de erros JavaScript conferidos.
- HTTP real em cópia temporária: painel disponível sem bot, `.env`, banco,
  sessão WhatsApp ou serviço configurado; POST de origem externa rejeitado.
- Criação do atalho `.url` conferida com WScript.Shell em arquivo temporário,
  sem alterar a área de trabalho do usuário.

Os testes do protocolo cobrem Host, Origin, CSRF, confirmação de interrupções,
rejeição de comandos arbitrários e agrupamento de consultas simultâneas. Os
testes administrativos cobrem configuração ausente, permissões insuficientes,
estado final inesperado, confirmação posterior do estado, comando de reinício,
exclusão mútua, falhas e consulta GitHub restrita. O worker real de inspeção foi
exercitado em diretório temporário vazio, sem criar backup ou arquivos.

Logs tiveram testes de redaction, leitura incremental, truncamento, rotação e
ordem dos arquivos. Heartbeat teve testes de PID diferente e expiração. Foram
observadas falhas antes das implementações e das correções de ordem, consultas
concorrentes, política de execução PowerShell e timeout do worker de backup.

## Revisão e simplificação

Revisão independente local de correção, segurança, confiabilidade, testes e UI.
Recibo `ce-code-review` concluído: `20261031-control-667915ef`, sem achados
acionáveis remanescentes no escopo implementado.
As correções trataram a política de execução do script PowerShell no processo
filho, o agrupamento de consultas de status pendentes e o timeout de criação de
backup que poderia interromper a liberação do bloqueio persistente. O teste de
reinício também exige o comando correto entre as conferências de estado.

A simplificação preservou as proteções e o reaproveitamento do backup existente;
o cache temporal redundante do status foi removido. Não foram adicionadas
dependências, migrations, regras comerciais ou outro supervisor de processos.

## Pendências explícitas

- Confirmar nome do serviço operacional, branch de produção e conta/permissões
  Windows. A consulta CIM foi negada no ambiente de desenvolvimento.
- Homologar os controles no servidor Windows pelo responsável, fora deste
  desenvolvimento: nenhuma parada, partida, reinicialização ou criação de backup
  operacional foi executada.
- Definir e aprovar estratégia de aplicação e recuperação de atualizações,
  principalmente quando houver migrations. **A etapa de aplicação permanece
  não implementada e bloqueada; a entrega do pedido integral está pendente.**
- Última data de instalação indisponível: não há registro confiável existente.

## Ajuste à referência visual recebida

Após a primeira entrega, foi recebida a imagem `TireFlow Server Dashboard in Dark
Mode.png`. O painel passou a seguir sua composição: quatro cards de status no
topo, controles verde/vermelho/azul, destaque para atualização, logs em estilo de
terminal e coluna direita de backup e atividades. Ícones SVG locais, sem novas
dependências, fontes externas ou imagens de dados fictícios.

Build, typecheck, sintaxe do JavaScript e 14 testes administrativos aprovados nesta
etapa. Chrome headless conferido em larguras 1672, 1440, 1024, 390 e 320 pixels,
sem overflow horizontal ou erros JavaScript, incluindo filtros e atualização
manual dos logs. Revisão independente do diff visual sem achados acionáveis.
As conferências usaram cópia temporária sem ambiente, banco, sessões ou serviço
configurado; nenhuma operação administrativa real foi executada.

Estados indisponíveis continuam explícitos. A atualização permanece desabilitada;
o desenho não acrescenta controles fictícios de agendamento ou configuração.

## Leitura dos arquivos diários de log

Corrigida a exibição que substituía mensagens operacionais por descrições genéricas.
O leitor agora preserva mensagens reconhecidas de carregamento, autenticação,
conexão, agendamento e diagnósticos seguros, com data/hora UTC original e nome do
arquivo. A prévia e o laboratório locais também passaram a consultar os arquivos
reais da pasta `logs`, somente por leitura, além dos eventos do processo de teste.

Arquivos diários e suas rotações permanecem separados. A tela reúne os três mais
recentes, acompanha o novo arquivo do dia e prioriza a cauda quando houver grande
volume entre consultas. O resultado fica limitado a 300 eventos cronológicos.
Payloads, mensagens privadas, credenciais, URLs, caminhos e identificadores
continuam protegidos. Texto livre desconhecido, inclusive do console do navegador,
é ocultado; uma tag operacional sozinha não autoriza sua exposição.

Verificação final: **636 testes da suíte isolada aprovados**, zero falhas;
typecheck, build e sintaxe JavaScript aprovados. Os 18 testes administrativos
incluem regressões de mensagens operacionais, fonte, troca de dia, crescimento
grande, limite cronológico, privacidade e leitura incremental. Conferência visual
por leitura em Chrome, em 1440, 390 e 320 pixels, sem erros ou overflow horizontal.
Os arquivos reais disponíveis produziram 220 eventos; carregamento e autenticação
do WhatsApp foram conferidos no navegador com filtros e fonte do arquivo.

Revisão focada concluída em `20261031-log-operational-review`, sem achados
acionáveis após corrigir os limites de privacidade identificados. A simplificação
preservou o leitor existente e substituiu a filtragem ampla por mensagens e
formatos seguros explícitos. Nenhuma dependência, migration, alteração de serviço
Windows, backup operacional, push ou deploy foi necessário nesta correção.

## QR atual no painel

Incluída a área de autenticação com um único canvas. Cada evento `qr` troca a
matriz e a revisão; autenticação, conexão, falha, desconexão, encerramento,
expiração e perda de comunicação removem a imagem. Nova solicitação de QR após
uma conexão anterior também retorna o estado do cliente a desconectado.

O QR fica em memória e percorre somente o canal local autenticado e o endpoint
com Origin/CSRF. O descritor ignorado contém PID, porta e credencial, sem QR.
O painel valida o PID do processo configurado, a validade e os limites da matriz.
Nenhuma dependência ou migration foi adicionada.

Os 22 testes focados passaram, incluindo eventos reais do cliente com payloads
fictícios, ausência de QR nos logs e transporte HTTP em processo isolado.
Chrome headless conferiu a troca efetiva da demonstração após 20 segundos,
limpeza dos pixels nos estados sem QR, expiração, matriz inválida, falha de rede
e desenho exato dos módulos com margem branca. Layout conferido em 1440, 390 e
320 pixels, sem overflow horizontal ou erros JavaScript. Capturas contêm apenas
QR fictício, sem autenticar conta. A revisão independente local do diff não
encontrou bloqueios de correção ou privacidade. Typecheck, build e sintaxe do
JavaScript aprovados.

Verificação final desta etapa: **643 testes da suíte isolada aprovados**, zero
falhas, além das conferências de transporte local e navegador descritas acima.

Pareamento real, serviço NSSM e ativação no servidor permanecem fora dessa
verificação. O laboratório usa somente o processo descartável e identifica
permanentemente seus códigos como demonstração.
