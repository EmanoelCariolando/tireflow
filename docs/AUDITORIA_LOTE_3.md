# Lote 3 — A5: validação numérica e financeira

Data: 2026-10-23. Branch: `melhorias/auditoria-tecnica`.
As três decisões comerciais foram respondidas e implementadas. A leitura
monetária agora é compartilhada; os limites e as diferenças entre preços,
pagamentos e quantidades estão descritos abaixo.

## Preservação

Todos os treze arquivos do Lote 2 foram revisados; não havia alteração inesperada
nem arquivo operacional ou sensível no diff. Os 59 testes específicos de A2
passaram novamente antes do commit local `ccfb2a1`:
`Fix stale product selections after replaced or failed queries (Lote 2)`.
A árvore estava limpa após o commit. Não houve push, merge ou deploy.

## Decisões comerciais aprovadas

1. `1.000` significa mil em todos os campos monetários. `1000,50` e `1000.50`
   significam 1000,50. Um agrupamento válido de milhares tem precedência sobre
   a interpretação decimal, tanto com ponto como com vírgula.
2. Formatos americanos aceitos em todos os campos monetários, incluindo
   `1,299.90`, `12,345` e `10,999`. Agrupamentos malformados são rejeitados.
3. Frações excedentes fora de agrupamento válido são arredondadas para centavos
   nos campos de preço, incluindo cadastro e alteração do total de uma pendência.
   Pagamentos e desconto em reais continuam exigindo no máximo duas casas.

Essas escolhas foram autorizadas explicitamente pelo usuário antes da alteração.
Exemplo: `1.234` e `1,234` são 1234, enquanto `1000.123` não é um agrupamento
válido: preço vira 1000,12 e pagamento é rejeitado. Não há nova confirmação para
desambiguar a grafia; confirmações comerciais já existentes foram preservadas.

## Problemas comprovados e correções técnicas

| Causa | Evidência anterior | Correção |
| --- | --- | --- |
| `Number('')` e `Number('   ')` resultam em zero | Contagem de saldo avançava com zero; preço também preparava preço zero | Leitura lexical antes de converter; ausência nunca equivale a zero explícito |
| Quantidades convertidas com `Number` sem validar a grafia | Entrada e ajuste aceitavam `1e3`, `0x10`, `+1` e `1.000`, diferentes do cadastro | Reutilização do leitor existente de inteiros não negativos, movido para utilitário com reexport compatível |
| Limites de número JS não correspondem ao schema | Cadastro aceitava inteiros acima de Int32; ajuste preparava saldo maior que o banco suporta | Faixa técnica de 0 a 2147483647 e validação do saldo resultante; quantidades de movimentação continuam positivas |
| Serviços não validavam todos os valores numéricos | Preço negativo, cadastro com estoque/preço negativo, preço `1e100` e pendência com total negativo eram persistidos em SQLite de teste | Guards antes de mutações e dentro das transações para resultados de soma; nenhum desses valores pode ser confirmado por chamada direta aos serviços |
| Centavos seguros após converter não garantem preservação do texto | `80000000000000.01` e `90071992547409.91` perdiam centavos ainda sem ultrapassar o teste antigo | Comparação com o decimal original e verificação de ida/volta por centavos antes de aceitar |
| Multiplicar Decimal antes de arredondar pode consumir a precisão disponível | `2.674999999999999999999999999` passava pela primeira comparação | Arredondar o decimal original para duas casas antes de multiplicar por cem; o caso foi reproduzido em RED |
| Leitor de preço duplicado | Preço e entrada continham a mesma conversão independente | O comando de preço usa o leitor já existente da entrada |
| Normalizadores divergentes e remoção de separadores antes de validar | Preço/entrada liam `1.000` como 1 e `1,299.90` como 1,30; pagamento recusava formato americano | `parseCurrencyToCents` reconhece agrupamentos BR/US; preço, entrada e cadastro compartilham o leitor, com política própria de arredondamento |
| Arredondamento binário antes de preservar o decimal | `1.0050` podia virar 1,00; cadastro rejeitava frações excedentes | Preços são arredondados com Decimal `ROUND_HALF_UP` antes da conversão para number; `1.0050` vira 1,01 e `2.6750` vira 2,68 |
| Alteração de preço da pendência usava o modo de pagamento | `1000.123` era recusado como novo preço total | O preço da pendência usa arredondamento; pagamento misto e desconto em reais seguem estritos |

O limite Int32 é técnico, não um novo teto comercial. O schema existente usa
`Int` para estoque e movimentos. Referências consultadas via Context7:
[Prisma/SQLite v6](https://www.prisma.io/docs/orm/v6/overview/databases/sqlite) e
[tipos escalares](https://www.prisma.io/docs/orm/data-modeling).

## Matriz final por domínio

Valores desta tabela são em reais; o leitor de pagamento os retorna em centavos.
Aceitar um preço prepara a confirmação: não grava imediatamente.

| Entrada | Preço/entrada | Cadastro: preço | Pagamento/desconto em reais | Quantidade | Saldo/cadastro: estoque |
| --- | --- | --- | --- | --- | --- |
| `1000` | Aceita 1000 | Aceita 1000 | Aceita 1000, sujeito ao total da operação | Aceita 1000 | Aceita 1000 |
| `1.000`, `1,000` | Aceita 1000 | Aceita 1000 | Aceita 1000, sujeito ao total | Rejeita | Rejeita |
| `1.000,50` | Aceita 1000,50 | Aceita 1000,50 | Aceita 1000,50, sujeito ao total | Rejeita | Rejeita |
| `1000,50` | Aceita 1000,50 | Aceita 1000,50 | Aceita 1000,50, sujeito ao total | Rejeita | Rejeita |
| `1000.50` | Aceita 1000,50 | Aceita 1000,50 | Aceita 1000,50, sujeito ao total | Rejeita | Rejeita |
| `0` | Aceita zero explícito, com confirmação | Aceita preço zero | Leitor retorna zero; pagamento parcial/desconto rejeitam | Rejeita | Aceita saldo zero; cadastro durante entrada exige positivo |
| `0,00` | Aceita zero explícito, com confirmação | Aceita preço zero | Leitor retorna zero; pagamento parcial/desconto rejeitam | Rejeita | Rejeita; saldo é inteiro sem separador |
| Vazio/espaços | Rejeita | Rejeita | Rejeita | Rejeita | Rejeita |
| Mídia sem legenda em etapa numérica | Rejeita ausência | Rejeita ausência | Não constitui valor; comprovantes seguem seu fluxo próprio | Rejeita ausência | Rejeita ausência |
| Texto inválido, negativo, `1e3`, `0x10`, `-0` | Rejeita | Rejeita | Rejeita | Rejeita | Rejeita |
| Inteiro acima de 2147483647 | Depende da faixa monetária, não da faixa de estoque | Idem | Idem | Rejeita | Rejeita |
| `1e100`, 310 dígitos, centavos fora da faixa segura ou sem ida/volta fiel | Rejeita | Rejeita | Rejeita | Rejeita | Rejeita |
| `1,299.90`, `R$ 1,299.90` | Aceita 1299,90 | Aceita 1299,90 | Aceita 1299,90, sujeito ao total | Rejeita | Rejeita |
| `12,345`, `100,999` | Aceita 12345 e 100999 | Idem | Idem, sujeito ao total | Rejeita | Rejeita |
| `1.234.567,89`, `1,234,567.89` | Aceita 1234567,89 | Idem | Idem, sujeito ao total | Rejeita | Rejeita |
| `1000.123`, `1,2345` | Arredonda 1000,12 e 1,23 | Idem | Rejeita frações excedentes | Rejeita | Rejeita |
| `1.0050`, `2.6750` | Arredonda 1,01 e 2,68 | Idem | Rejeita frações excedentes | Rejeita | Rejeita |
| `1.234,567`, `1,234.567` | Arredonda 1234,57 | Idem | Rejeita frações excedentes | Rejeita | Rejeita |
| `12.34,56`, `12,34.56`, separadores repetidos indevidamente | Rejeita | Rejeita | Rejeita | Rejeita | Rejeita |

Os menus numéricos continuam distinguindo índices de produtos, ações e
quantidades. O guard de dígitos já existente no menu foi preservado; a quantidade
do menu também verifica a faixa Int32. Desconto percentual mantém o leitor
existente de até duas casas e intervalo estrito entre 0 e 100, sem milhares.
O preço alterado de uma pendência é o total da venda e segue o arredondamento
de preços; `0` continua sendo a ação voltar nessa etapa. Quantidades e saldos
aceitam somente dígitos, com espaços externos opcionais. Os leitores monetários
mantêm o suporte preexistente a `R$` e espaços na representação.

## Precisão e regras preservadas

- Acréscimo de 5,8% a prazo, regras de comissão, desconto, nota e preço 10X não
  foram alterados. O preço 10X continua sendo o total unitário, não uma parcela.
- `isSafeMonetaryValue` verifica finitude, sinal e faixa de centavos. Quando o
  texto normalizado está disponível, compara o arredondamento do decimal exato
  com o cálculo numérico e sua representação após dividir os centavos por cem.
- A comparação usa `Prisma.Decimal` já instalado, sem dependência nova. Não
  reescreve os totais nem arredonda preços unitários internos de desconto.
- `29 / 3` permanece válido como preço unitário rateado de uma venda de três
  itens com total 29; dinheiro, nota e misto foram testados. Não se exige que um
  preço unitário calculado tenha apenas duas casas.
- Totais, rateio dos pagamentos e representação Decimal no banco mantêm o fluxo
  existente. Não houve migração nem conversão de dados operacionais.
- O leitor arredonda o texto decimal primeiro e valida a representação resultante
  em centavos. A cauda `2.674999999999999999999999999` agora resulta em 2,67 no
  preço, sem arredondamento binário indevido para 2,68; pagamento a rejeita.
- Valores cujo centavo arredondado não tem representação segura são rejeitados.
  Dados antigos não são convertidos nem reparados automaticamente.

## Testes e resultados

Novos: `tests/numericValidation.test.ts` e
`tests/numericIntegrity.integration.test.ts`; complementados
`tests/mixedPayment.test.ts` e `tests/pendingSale.test.ts`. RED observado antes das correções
nos leitores, contagem vazia, serviços e perda de centavos. Mídia, zero explícito,
valores válidos e pagamentos foram verificados com mensagens fictícias e SQLite
descartável sob o isolamento do Lote 1.

- Precisão e convenções aprovadas tiveram RED registrado antes das respectivas
  correções. A primeira versão do teste de centavos multiplicava um float para
  obter o esperado; essa expectativa foi corrigida para centavos inteiros
  literais, evitando reproduzir no teste a imprecisão que se quer impedir.
- O caso de cauda decimal longa agora testa o resultado arredondado correto no
  preço e a rejeição no pagamento, conforme a decisão aprovada.
- A revisão identificou o preço da pendência ainda estrito; três casos novos
  falharam antes de habilitar o arredondamento nesse campo.
- Verificação final dos novos e relacionados: 153 aprovados, zero falhas,
  cancelados ou ignorados, saída 0. São 110 casos adicionais sobre os 325 do
  Lote 2: 78 em `numericValidation`, 27 em `numericIntegrity` (inclui agrupador),
  um em `mixedPayment` e quatro em `pendingSale`.
- Suíte completa final: `npm test`, 435 aprovados, zero falhas, cancelados ou
  ignorados, saída 0, duração de 51,8 segundos no isolamento do Lote 1.
- `npm run typecheck` e `npm run build`: ambos passaram, saída 0.
- Checagem de tipos separada cobre também os quatro arquivos de testes alterados.
- Lint: não há script no projeto; nenhuma ferramenta adicionada.
- `git diff --check`: passou; Git apenas informa a conversão habitual LF/CRLF.

## Revisão e pendências reais

Ponytail independente e revisão diferencial de validação/integridade com os
critérios Trail of Bits. A revisão encontrou a limitação da comparação decimal
inicial; ela foi reproduzida e corrigida. Um suposto bypass no menu foi descartado
após confirmar o guard lexical preexistente. Não se registra hipótese como bug.
A revisão final confirmou o fechamento do achado de precisão e do preço da
pendência sem arredondamento. Nenhum achado concreto dessa revisão permanece aberto.

Permanecem abertos:

- Devolução de pendência após reabastecer o produto até Int32 pode exceder o
  saldo permitido. O Prisma rejeita e a transação faz rollback; a pendência
  permanece aberta. Esse comportamento preexistente não foi alterado e não se
  alega que todos os fluxos de overflow passaram a ter mensagem específica.
- A aplicação continua usando `number` para cálculos internos. O guard de texto
  não recupera precisão que já tenha sido perdida em dados antigos; não houve
  auditoria nem correção de dados operacionais.
- Não foram feitos testes com WhatsApp real nem acessados banco, uploads,
  autenticação ou credenciais operacionais. Nenhum push, merge ou deploy.

## Arquivos e Git

HEAD `ccfb2a1`, branch `melhorias/auditoria-tecnica`. Alterações do Lote 3 sem
commit; o índice permanece vazio. Lote 4 não iniciado.

- Comandos: `adjustmentCommand.ts`, `entryCommand.ts`, `priceCommand.ts`,
  `productActionCommand.ts`, `productRegistrationParsers.ts`, `saleCommand.ts`,
  `saleParsers.ts` em `src/commands/`.
- Serviços: `adjustmentService.ts`, `entryService.ts`, `pendingSaleService.ts`,
  `priceService.ts`, `productRegistrationService.ts`, `saleService.ts` em
  `src/services/`.
- Utilitários: `src/utils/entrySessionHelpers.ts`, `src/utils/salePayment.ts` e
  `src/utils/stockQuantity.ts` (novo).
- Novos: `tests/numericValidation.test.ts`, `tests/numericIntegrity.integration.test.ts`
  e este relatório. Atualizados: `tests/mixedPayment.test.ts` e `tests/pendingSale.test.ts`.

Total: 21 arquivos no Lote 3 (17 modificados e quatro novos). Nenhuma dependência,
migração ou configuração operacional foi alterada. As mudanças comerciais
observáveis são as três convenções explicitamente aprovadas, detalhadas na matriz.
