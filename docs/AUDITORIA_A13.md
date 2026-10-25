# A13 — Autorização coletiva e modo privado de testes

Data: 2026-10-24. Branch: `melhorias/auditoria-tecnica`.

Correção posterior de compatibilidade: a entrada agora recupera `_serialized`
ausente antes da guarda, reutilizando o leitor de IDs dos comprovantes. A causa
real, a reprodução e a nova validação estão em [DIAGNOSTICO_RECEPCAO.md](DIAGNOSTICO_RECEPCAO.md).
Os resultados e o estado de 18 arquivos abaixo registram a revisão A13 anterior
a essa correção; a política de acesso não foi alterada.

## Preservação e escopo

HEAD permanece `e48d052`, commit do Lote 5. Antes da simplificação, os 18 arquivos
pendentes pertenciam exclusivamente ao A13 anterior, validado com 560 testes.
A política anterior foi substituída por instrução explícita do usuário; não houve
reset, exclusão de trabalho de outros lotes ou commit. A14 e A15 não foram implementados.

A única configuração de autorização privada é `ALLOW_PRIVATE_TEST_MODE`.
Foram removidos o campo da lista, seu parser, validações, fixtures e documentação.
Nenhuma variável nova, tabela, migração ou dependência foi introduzida.

## Política implementada

| Origem | Regra |
| --- | --- |
| Grupo oficial, remetente individual identificado | Todos os comandos; não exige cadastro, role ou atividade |
| Grupo oficial, remetente ausente ou inválido | Recusar antes de comandos/sessões |
| Outro grupo válido | Bloquear operações; preservar `grupo id` apenas para identificar a própria conversa |
| Privado válido, flag explicitamente true | Todos os comandos, para qualquer remetente |
| Privado, flag false, ausente, vazia ou inválida | Bloquear comandos, inclusive continuações e confirmações |
| Mensagem do próprio bot, status, broadcast ou origem não suportada | Ignorar |
| Usuário existente inativo | Pode operar; permanece inativo depois das operações |
| Usuário novo | Preservar role e atividade padrão do cadastro |

A decisão de permitir qualquer remetente privado com a flag ligada foi explícita.
Não há autorização por nome exibido, telefone escrito na mensagem, menções,
contato salvo, destinatário de notificações ou cadastro individual.

## Identidade e sessões

A origem confiável continua sendo o evento `message` do cliente WhatsApp em
`src/index.ts:76`. O formato de um identificador não autentica uma pessoa por si
só. Não foi criado endpoint externo nem suporte a objetos arbitrários enviados
por terceiros fora desse cliente.

`hasValidMessageIdentity` valida o envelope antes dos comandos: remetente e
conversa, autor individual no grupo, `id.remote`, ID interno/serializado e
coerência de `fromMe`. Broadcasts também são recusados quando a propriedade
`broadcast` é true, mesmo se a conversa tiver domínio individual válido.

O grupo oficial é comparado pelo ID completo. Grupos atuais e legados com
`numero-numero@g.us` são suportados; nome do grupo não participa da decisão.
Grupo sem autor não usa mais o próprio ID do grupo como identidade de usuário.

No privado, a conversa identifica o remetente; um autor informado precisa ser
coerente com ela. Os identificadores `@lid` e `@c.us` são mantidos completos e
não são unificados nem convertidos por semelhança dos dígitos.

O coordenador e as chaves existentes de conversa/usuário foram preservados.
As verificações se aplicam a comandos, menus, seleções numéricas, mídia,
continuações, cancelamentos e confirmações. Negação é silenciosa e não divulga
dados ou estado de sessões. Não houve alteração nas validações financeiras ou
nas regras de estoque, preços e pendências.

`upsertByPhone` não reativa usuários existentes. A correção compartilhada atende
as nove chamadas de venda, entrada, ajuste, transferência, preço, cadastro com
estoque, criação/atribuição e devolução de pendência. A atividade de produtos não
foi modificada.

## Configuração

```env
ALLOW_PRIVATE_TEST_MODE=true
```

Esse valor habilita qualquer conversa privada tecnicamente válida. Não há outra
configuração de autorização privada. `false`, ausência e valores inválidos são
interpretados como desabilitado. Espaços externos e maiúsculas na representação
booleana são tratados como antes. A configuração é lida uma vez na inicialização;
mudanças exigem reinício, que descarta as sessões em memória.

`OWNER_PHONE` e `BOSS_PRIVATE_NUMBER` continuam destinados às notificações e
relatórios; seus requisitos globais preexistentes de inicialização não foram
alterados. Eles não são consultados para conceder acesso a comandos privados.

O `.env` operacional não foi lido nem alterado. Somente `.env.example`, template
público, e `docs/PRODUCTION.md` foram ajustados.

## Testes e evidências

A rodada RED da simplificação demonstrou que a implementação anterior bloqueava
privados válidos sem autorização individual. Também reproduziu processamento de
uma mensagem com `broadcast=true` e ID válido. A correção remove o condicionamento
à lista e acrescenta a recusa explícita do broadcast.

Os testes mantêm os cenários válidos e negativos do A13 e cobrem:

- Grupo com usuário ativo, inativo, roles diferentes e desconhecido.
- Outros grupos recusados, com a exceção informativa segura.
- Privados com remetentes distintos, sem cadastro individual e com flag ligada;
  usuário existente inativo permanece inativo e novo mantém o padrão.
- Flag desligada, ausente, vazia ou inválida; nenhuma habilitação implícita.
- Identidades `@lid` e `@c.us`, inclusive os mesmos dígitos sem compartilhar sessão.
- Remetente ausente, campos contraditórios, IDs incompletos, bot, status, broadcast
  e canais/origens não suportados.
- Continuação de entrada no grupo e no privado, confirmação de venda e proteção
  contra continuação/cancelamento por outro usuário ou conversa.
- Desabilitação do privado antes da confirmação: não grava nem cancela a sessão.
- Ausência de alterações em usuários, produtos, movimentações e pendências quando
  acesso é negado; ausência de dados sensíveis na resposta.
- Todos os chamadores operacionais do upsert preservando inativos, inclusive o
  responsável mencionado em uma pendência.
- Processos separados comprovando a configuração fixa até reinício e sua aplicação
  após reinício; grupo continua funcionando com flag privada inválida.

Testes de exigência da lista foram substituídos pelos da política nova. As
fixtures e proteções de concorrência, seleção antiga e integridade numérica dos
lotes anteriores foram preservadas.

## Verificação final

| Verificação | Resultado real |
| --- | --- |
| Suíte completa isolada (`npm test`), após a última alteração de testes | 560 aprovados, zero falhas/cancelamentos/skips, saída 0, 71,74 s |
| Cinco arquivos focados, antes do reforço final de asserções coberto pela suíte completa | 118 aprovados, zero falhas/cancelamentos/skips, saída 0, 15,03 s |
| `npm run typecheck` | Aprovado, saída 0 |
| `npm run build` | Aprovado, saída 0 |
| TypeScript separado dos dois novos arquivos de testes | Aprovado, saída 0 |
| `git diff --check` | Aprovado |
| Revisão independente Ponytail | Apta, sem P1/P2 comprovado no diff |

A revisão rastreou a entrada do SDK, validadores, chamadores de identidade, nove
operações que usam o upsert, testes e documentação. Não existe script de lint
configurado; nenhuma ferramenta foi instalada. A busca nos arquivos de código,
testes, scripts, documentação e template confirmou a remoção do requisito antigo
da lista privada. As verificações de diff confirmaram ausência de alterações em
serviços de negócio, schema e manifests de dependências.

## Arquivos envolvidos no A13 acumulado

- Produção: `src/config/env.ts`, `src/utils/messageContext.ts`,
  `src/whatsapp/messageHandler.ts`, `src/repositories/userRepository.ts`.
- Isolamento/fixtures: `scripts/run-tests.cjs`, `tests/testIsolation.test.ts`,
  `tests/authorizationAndHealth.test.ts`, `tests/environment.test.ts`,
  `tests/groupAuthorization.test.ts`, `tests/numericIntegrity.integration.test.ts`,
  `tests/operationConcurrency.test.ts`, `tests/productName.integration.test.ts`,
  `tests/queryContext.integration.test.ts`.
- Testes novos do A13: `tests/authorizationSecurity.test.ts`,
  `tests/privateAuthorizationConfig.test.ts`.
- Template/documentação: `.env.example`, `docs/PRODUCTION.md`, este relatório.

## Limitações e Git

A política permite comandos e relatórios a qualquer remetente privado identificado
quando habilitada, por decisão explícita de testes. A verificação de identidade
não substitui o controle do cliente/sessão WhatsApp nem idempotência durável.

Não houve conexão real do WhatsApp, leitura de credenciais, dados operacionais ou
sessões autenticadas. A compatibilidade foi avaliada pelo SDK instalado 1.34.7 e
mensagens simuladas. Mudanças de envelope podem exigir adequação; não devem ser
resolvidas por fallback permissivo.

LID e telefone não são unificados. Uma troca de identificador pode exigir iniciar
outra operação. A14 e A15 continuam pendentes, sem modificações nesta etapa.

Branch `melhorias/auditoria-tecnica`, HEAD `e48d052`; A13 sem commit e índice vazio.
São 18 arquivos novos/modificados no A13 acumulado, todos listados acima. Nesta
simplificação foram ajustados os três arquivos de autorização (config/contexto/
handler), cinco arquivos de testes, o runner e os três arquivos de documentação/
template; os demais ajustes existentes do A13 foram preservados.
Sem alterações de schema/dependências, push, merge, deploy ou avanço de lote.
