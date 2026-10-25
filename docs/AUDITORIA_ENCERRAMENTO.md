# Último lote pontual — 24/10/2026

Branch `melhorias/auditoria-tecnica`, base `0a34e0c`. Escopo limitado a A6, A7, A8,
A9, A12 e A18; nenhuma dependência, migration, tabela ou regra comercial adicionada.

## Alterações

- **A6:** `priceService` registra e retorna os preços efetivos lidos na transação.
  Confirmações do comando usam esses valores. O coordenador existente continua
  serializando gravações; permanece a política de a última alteração confirmada prevalecer.
- **A8:** destino não resolvido falha, em vez de retornar como sucesso. O agendador
  recupera envios depois do horário, somente no mesmo dia, e adquire seu boolean
  antes da primeira leitura assíncrona. Mantém o estado existente em memória/arquivo.
- **A7:** diário reutiliza `buildStockHistory` do mensal e a consulta de pendências
  por abertura/resolução. Reserva que zera aparece na abertura; fechamento posterior
  continua sendo venda financeira, sem inventar nova baixa de estoque.
- **A12:** a consulta de baixo estoque mantém `tenInstallmentPrice` e mostra 10x
  quando há preço positivo, preservando a seleção e a venda por índice.
- **A9:** erro de recuperação de recibo não inclui seu ID; JIDs em `Error.message`
  são mascarados. QR só é renderizado em TTY. Serviço sem terminal recebe orientação
  para autenticar interativamente, conforme o procedimento de NSSM existente.
- **A18:** primeira gravação de cada dia UTC reutiliza a limpeza de logs existente.
  Não há timer novo. Falha na limpeza é relatada e não impede a gravação do log;
  outra tentativa fica para o próximo dia, evitando repetir falhas a cada mensagem.

## Evidências e limites

Testes foram executados antes das correções: histórico concorrente registrava
`100→120` e `100→130`; checks simultâneos enviavam três relatórios; recuperação
fora do minuto não enviava; destino ausente era marcado como enviado; reserva não
aparecia no diário; consulta de baixo estoque perdia 10x; QR saía em stdout redirecionado;
erro expunha ID e logs antigos permaneciam após mudança de dia.

Regressões cobrem também preços da confirmação, total financeiro no fechamento,
devolução, 10x ausente, falha de envio e posterior sucesso, estado já persistido,
horário anterior ao envio, terminal interativo e erro de limpeza sem perda do log.

- **A14 permanece documentado:** sem persistência adicional ou mudanças de sessão.
  Deduplicação em memória não garante idempotência entre reinícios. O marcador
  diário impede repetições nas verificações normais e quando o estado de sucesso
  está salvo e legível. Queda entre envio e persistência, arquivo perdido/corrompido
  ou timeout após aceite remoto podem causar reenvio. Sucesso aqui é retorno do SDK,
  não comprovante de leitura/entrega. Não foi prometido envio único nesses cenários.
- **A17 permanece documentado:** intervalos/agendamento usam o fuso do processo;
  algumas apresentações fixam São Paulo. O runner usa `America/Sao_Paulo`; fuso
  operacional não foi inspecionado nem alterado. Não houve reescrita de datas.
- **A16:** proteções numéricas do Lote 3 preservadas e incluídas na suíte completa.
- Sem benchmarks ou otimizações por hipótese. Sem dados, credenciais, sessões ou
  WhatsApp operacionais. Sem push, merge ou deploy.

## Verificação

Os 45 testes focados passaram. Typecheck, build, verificação TypeScript adicional
dos arquivos de teste alterados e `git diff --check` passaram. Revisão independente
Ponytail ao final não encontrou defeitos concretos nas alterações.
A suíte completa isolada passou com **596 testes, zero falhas, zero cancelados e
zero ignorados**, em 85,4 segundos. Recomenda-se encerrar a auditoria no escopo aprovado,
mantendo A14/A17 documentados, sem iniciar novos lotes por padronização ou hipótese.
