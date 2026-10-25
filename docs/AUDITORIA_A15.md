# A15 — restauração de estoque e cargas concorrentes

Escopo: alterações mínimas sobre os mecanismos dos Lotes 1–5 e A13. Sem mudanças de schema,
dependências, regras comerciais ou fluxo do WhatsApp. Testes somente em cópias isoladas e SQLite
descartável; nenhum acesso a banco, imagens ou autenticação operacionais.

## Correções

- `restoreLocationStock.ts` aceitava saldo zero ou igual ao snapshot sem verificar atividade.
  Uma venda ou reserva de todo o estoque permitia recriar unidades; venda seguida de entrada
  podia devolver o mesmo saldo e esconder a atividade. Agora a consulta existente também conta
  movimentos `SALE`/`ENTRY`/`ADJUSTMENT` e itens de pendência por produto no snapshot e no banco
  atual. Diferenças são conflitos. Não carrega o histórico inteiro nem usa horários como prova.
  `--apply` aborta sem alterações; `--apply-safe` preserva os conflitos e restaura os demais.
  Limpeza administrativa sem movimentos continua recuperável; preço novo permanece intacto.
- Cargas absolutas podiam ler e gravar enquanto o bot ou outra carga alterava o estoque.
  `syncProductStocks`, `syncProductCatalog`, os dois importadores de pneus, `clearLocationStock`
  e `restoreLocationStock` agora reutilizam o lock de manutenção existente ao aplicar.
  Um helper de seis linhas mantém o lock desde antes do planejamento até o disconnect, liberando
  também em falhas. Conferência sem aplicação continua permitida. Nenhuma fila ou novo lock.

## Limpeza e A14

Removido somente `src/repositories/sessionRepository.ts` (86 linhas): nenhum import, chamada,
exportação agregada ou carregamento dinâmico no código, testes, scripts ou configuração do pacote.
As tabelas e migrations de sessões permanecem intactas. Parsers parecidos com contratos diferentes
foram preservados. Não há evidência para remover dependências ou alterar consultas do caminho normal.

A14 permanece condicional: a deduplicação em `messageDeduplication.ts` usa memória, dez minutos
e até 5.000 eventos. Transações, coordenador por usuário/conversa e resolução atômica de pendências
já protegem vários casos. Falha na resposta após commit é tratada por `runPostCommitTask`, seguida
da limpeza da sessão. Reinício também perde as sessões; isso, sozinho, não prova duplicação.
Um evento antigo fora da deduplicação pode confirmar uma nova sessão compatível. Não foi adicionada
persistência, migration nem heurística que bloqueie vendas legítimas; uma garantia entre reinícios
exige aprovação separada. O ID recuperado na recepção continua participando da deduplicação atual.

## Garantias e limites

- Testes novos exercitam vendas/reservas até zero, retorno ao mesmo saldo, restauração parcial,
  limpeza legítima, preço preservado, seis CLIs recusando escritor ativo, duas cargas reais
  concorrentes, conferência durante manutenção e liberação do lock após erro e sucesso.
- As relações já possuem índices por produto; a comparação acrescenta contagens somente ao
  comando administrativo. Não acrescenta consultas ou memória ao processamento de mensagens.
- O lock cobre processos atualizados que usam o mesmo caminho de banco. Ferramentas externas,
  processos antigos e aliases diferentes do mesmo arquivo exigem manutenção coordenada.
- Contagens detectam o histórico acrescentado pelos fluxos suportados. Reescrever manualmente
  históricos mantendo as mesmas contagens ou carregar saldos sem histórico não permite concluir
  que o snapshot ainda é seguro; exige reconciliação manual. CSV antigo continua exigindo revisão
  da data-base e das reservas. Cargas continuam absolutas, sem conversão implícita para deltas.
- Backups compatíveis continuam aceitos. Se as relações necessárias não puderem ser consultadas,
  a restauração falha antes de escrever; não assume histórico vazio nem migra o backup.

## Validação

Antes da correção, os testes focados tiveram 15 falhas e seis aprovações. Depois, os mesmos
21 testes passaram. A seleção ampliada (A15, cargas, importadores, pendências, concorrência,
recepção e deduplicação) passou com 40 testes. A suíte completa isolada passou com **584 testes,
zero falhas, zero cancelados e zero ignorados** (92,5 segundos).

`npm run typecheck`, verificação TypeScript separada dos dois arquivos de teste alterados,
`npm run build` e `git diff --check` passaram, com saída zero. Não existe script de lint neste
projeto. Revisão independente Ponytail com foco em segurança e integridade não encontrou defeitos
concretos no diff; validou os seis callers do lock, fluxos de histórico/reservas, safety backup,
liberação em erro e cobertura dos testes. Não foi feito benchmark de CPU ou memória: nenhuma
otimização foi alegada sem medição.
