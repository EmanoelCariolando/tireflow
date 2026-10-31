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
