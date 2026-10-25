# Correção da recepção WhatsApp após A13

Data: 2026-10-24. Branch: `melhorias/auditoria-tecnica`, HEAD `e48d052`.

## Causa demonstrada

O rastro real fornecido pelo usuário mostrou:

```text
created → received → handler_entered → identity_rejected
sourceKind=lid, remoteKind=lid, remoteMatches=true
self=false, idSelf=false, internalIdPresent=true
serializedIdPresent=false, privateMode=true
```

A mensagem de outra conta chegou ao SDK e ao handler. O modo privado estava
habilitado e a conversa era coerente. A recusa foi provocada pela obrigatoriedade
de `_serialized`, um campo derivado que não veio nesse envelope, embora o ID
interno estivesse disponível. Não era ausência de autenticação, bloqueio da flag
ou falta de eventos para esse teste externo.

Os avisos HTTP/preload não foram necessários para reproduzir a falha: a mensagem
já tinha sido recusada antes da resposta. Não foi alterado browser ou SDK para
tratar esses avisos.

## Correção mínima

O projeto já recuperava IDs sem `_serialized` nos comprovantes de venda. Esse
leitor foi extraído de `saleCommand.ts` para `getSerializedMessageId`, no utilitário
existente `messageContext.ts`, e reutilizado na entrada de mensagens.

A entrada ignora mensagens próprias e prepara o campo derivado antes da guarda
A13 e da deduplicação. A composição existente foi preservada:

- Privado: `fromMe_remote_id`.
- Grupo: `fromMe_remote_id_participant`, quando há participante.
- Um ID serializado já fornecido pelo SDK não é substituído.
- Dados-base incompletos ou tipos inválidos não são promovidos a uma identidade
  válida. As verificações de coerência de conversa, autor, flags e status/broadcast
  continuam aplicadas depois da preparação.

Não foi removida a deduplicação: a mesma mensagem recebida como outro objeto do
SDK produz o mesmo identificador e continua sendo ignorada como duplicada. Uma
nova mensagem permanece utilizável. O campo também fica disponível para o
`quotedMessageId` utilizado por `Message.reply` e pelos leitores de mídia.

A política permanece igual: grupo oficial coletivo e qualquer privado válido com
`ALLOW_PRIVATE_TEST_MODE=true`, sem lista, cadastro, role ou atividade para autorizar.
LID e telefone não são associados automaticamente. Regras de estoque, preço,
pagamento e pendências não foram alteradas.

## Instrumentação temporária

Os rastros cumpriram sua finalidade. Foram removidos de `index.ts`, `logger.ts`,
`menuCommand.ts` e do handler; os três primeiros retornaram ao conteúdo anterior.
Os logs normais e a fronteira de exceções foram preservados. Não é necessário
habilitar debug para usar a correção. Não ficam gravações extras por mensagem.

O receptor operacional continua somente em `message`. O teste do callback real
do SDK 1.34.7 com página simulada confirma que `message_create` inclui mensagens
próprias e que `message` as exclui. Não se trocou o evento para executar comandos
originados pela conta do próprio bot.

## Testes

Três reproduções RED usaram a classe Message do SDK, sem `_serialized`, para
privado LID, privado telefone e grupo identificado. Antes da correção, nenhuma
resposta era chamada. Depois da correção, o menu foi encaminhado ao transporte
simulado e a referência de resposta continha o ID recuperado.

Cada caso verifica também repetição do mesmo evento e uma mensagem nova legítima.
Os testes usam transporte simulado por instância, mantendo intacta a guarda
global do runner que bloqueia rede e WhatsApp reais.

A condição antiga que considerava a simples ausência de `_serialized` inválida
foi substituída por esses testes positivos; permanecem negativos os IDs-base
incompletos, remoto contraditório, autor inválido e serialização de tipo inválido.
O teste de propagação de falhas de resposta foi preservado após retirar os rastros.

| Verificação | Resultado real |
| --- | --- |
| Suíte completa isolada após retirar a instrumentação temporária | 566 aprovados, zero falhas/cancelamentos/skips; saída 0; 75,75 s |
| Testes focados de recepção, autorização, deduplicação e pagamento misto | 59 aprovados, zero falhas; saída 0 |
| `npm run typecheck` e `npm run build` | Aprovados, saída 0 |
| TypeScript separado do teste de recepção | Aprovado, saída 0 |
| `git diff --check` | Aprovado |
| Revisão independente Ponytail | Apta, sem P1/P2; resposta real confirmada depois pelo usuário |

## Como validar com dois números

1. Iniciar manualmente apenas a instância pretendida com o build atualizado.
   A é a conta conectada ao bot; B é uma conta distinta.
2. Manter `ALLOW_PRIVATE_TEST_MODE=true` e enviar `menu` de B para A, depois de
   `ready`. O menu deve aparecer em B e o log normal deve registrar entrada
   autorizada. Os antigos `[MESSAGE_TRACE]` não aparecem mais.
3. Enviar um novo `menu` de B para A: uma mensagem nova não deve ser confundida
   com duplicação. No grupo oficial, B identificado também deve obter o menu.
4. Envio pela própria conta A continua ignorado por decisão existente; ele não
   valida o recebimento de outra conta.

O defeito demonstrado foi reproduzido e corrigido em testes isolados. Depois de
reiniciar e testar com outro número, o usuário confirmou: voltou a responder.
Essa confirmação valida a recuperação da resposta no teste privado; não foi
estendida a vendas ou outros fluxos reais que não foram testados pelo usuário.
O agente não iniciou conexão nem enviou mensagem operacional.

## Arquivos e limites

Correção: `src/utils/messageContext.ts`, `src/whatsapp/messageHandler.ts` e
`src/commands/saleCommand.ts` (extração do leitor existente, sem regra comercial).
Testes: `tests/messageReception.test.ts`, `tests/authorizationSecurity.test.ts`.
Este relatório registra evidências, enquanto o relatório A13 anterior mantém o
histórico da política e da validação que antecederam esta correção.

Não foram acessados `.env`, credenciais, banco operacional ou sessões autenticadas.
Não houve instalação de dependências, alteração de schema, commit, push, merge,
deploy ou início de outro lote. A14/idempotência durável e A15 seguem pendentes.

Estado final: branch `melhorias/auditoria-tecnica`, HEAD `e48d052`, índice vazio,
alterações locais sem commit. O trabalho A13 anterior foi preservado.
