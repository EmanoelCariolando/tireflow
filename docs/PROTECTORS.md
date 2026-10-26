# Protetores

Pesquise com `protetor` para listar os disponíveis ou `0 protetor` para listar os zerados.
Use somente essas formas: o bot orienta entradas parecidas, como `protetores`, `protetro`
e `protetor 16`, sem executar uma pesquisa diferente nem conservar a seleção antiga.
Depois da busca, escolha o item pelo número. Venda, entrada, ajuste, preço, foto e local
usam os fluxos existentes. A comissão é **1%**, como câmaras e baterias, preservando
as exceções atuais de comissão zero.

## Catálogo aprovado

Fonte: `CAMARAS DE AR E PROTETORES 15.10.26.pdf`, páginas 2 e 3. A primeira coluna
monetária é o preço a prazo, a segunda é à vista; a última coluna é o saldo, conforme
o padrão do catálogo de câmaras. Os números abaixo foram conferidos no PDF.

| Modelo | À vista | A prazo | Saldo inicial |
| --- | ---: | ---: | ---: |
| PROTETOR 16 | R$49,00 | R$51,84 | 16 |
| PROTETOR 20 | R$69,00 | R$73,00 | 5 |
| PROTETOR 22 | R$79,00 | R$83,58 | 11 |
| PROTETOR 24 | R$149,00 | R$157,64 | 1 |
| PROTETOR 25 | R$189,00 | R$199,96 | 1 |
| PROTETOR 30 ABC | R$199,00 | R$210,54 | 1 |

Total: seis modelos, 35 unidades. Por decisão do usuário, os protetores **15, 17, 26,
28 e 34** ficam pendentes: o PDF não informa seus preços e seus saldos estão zerados.
Nenhum valor zero foi inventado para esses cinco modelos. As câmaras do PDF não são
reimportadas por este comando.

## Preparar e importar

Categoria `TIRE_FLAP`, separada de pneus e câmaras, na coluna textual já existente do
SQLite. Não requer alteração da estrutura do banco nem migration. Regenere o cliente
Prisma para disponibilizar a nova categoria e compile:

```powershell
npm run prisma:generate
npm run build
```

O importador segue a filial Congo, como o catálogo existente de câmaras. Pare o serviço
da filial, confira o backup e revise os saldos do documento antes de aplicar:

```powershell
npm run import:protectors
npm run import:protectors -- --apply
```

Sem `--apply`, somente confere. A aplicação reutiliza o bloqueio de manutenção desde
antes da leitura até a desconexão. Só cria modelos ausentes; não substitui saldos,
preços, fotos ou atividade de cadastros existentes. Reexecução não desfaz vendas.
CSV inválido ou identidade conflitante interrompe a importação sem alterações.
Depois de concluir, reinicie uma única instância com o build atualizado.

Nenhum desses comandos foi aplicado ao banco operacional durante o desenvolvimento.

## Validação

- 17 testes focados aprovados: catálogo, importação sem alterações na conferência,
  reexecução preservando venda, comissão, buscas, ajuda, seleção, isolamento, falhas,
  bloqueio de manutenção, CSV inválido e cadastros conflitantes.
- Suíte completa isolada executada em sequência: **605 aprovados, zero falhas**.
  A execução paralela teve uma falha de cenário (mais o teste pai) em manutenção:
  outra fixture removeu uma foto da pasta temporária compartilhada durante o backup.
  O mesmo cenário passou em sequência; não foi alterado o backup nem o runner.
- Typecheck, build, tipos dos testes alterados e `git diff --check` aprovados.
- Revisão final local pelo critério Ponytail, sem outro defeito concreto encontrado.
  A revisão independente foi iniciada, mas não concluída por limite da ferramenta.

Não foram utilizados WhatsApp, autenticação ou banco operacionais nos testes.
