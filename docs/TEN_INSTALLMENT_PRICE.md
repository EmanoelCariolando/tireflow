# Preço 10X

O preço 10X representa o total unitário da coluna 10 X, não o valor de uma parcela.
Na escolha do valor, a opção 3 aparece somente quando há um preço 10X cadastrado.
O total considera a quantidade e segue os fluxos de pagamento, desconto e pendência.

Ao alterar efetivamente o preço à vista de um produto existente, o preço total unitário
10X passa a ser o novo preço à vista × 1,092, arredondado para centavos. A regra vale para
o comando de preço, entradas com alteração de preço e importadores que mudem o preço
à vista. Não há atualização em massa: preço à vista inalterado preserva o 10X atual,
inclusive em atualizações apenas de estoque, descrição ou preço a prazo. O percentual
é aplicado ao novo preço à vista, sem acumular sobre o 10X anterior.
Vendas já registradas e seus valores históricos permanecem inalterados.

Fonte: PNEUS PAZ LUCAS CONGO 30.09.26.pdf. Os preços à vista, a prazo e estoques
existentes são preservados. Correspondências usam medida e descrição exatas,
incluindo as decisões MATCH já registradas em congo_catalog_resolution.csv.
Itens sem correspondência ficam no relatório tmp/ten-installment-import-review.json;
não são criados ou associados por semelhança.

No servidor Congo, após transferir o código e data/seed atualizados, parar o bot e
criar backup, executar um comando por vez:

```powershell
npm.cmd install
npx.cmd prisma generate
npx.cmd prisma migrate deploy
npm.cmd run build
npx.cmd tsx src/database/importTenInstallmentPrices.ts
npx.cmd tsx src/database/importTenInstallmentPrices.ts --apply
```

Reiniciar o serviço após sucesso. O importador modifica somente tenInstallmentPrice.
