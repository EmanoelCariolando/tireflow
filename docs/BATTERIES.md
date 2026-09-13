# Catálogo de baterias

O TireFlow aceita baterias das marcas **Moura** e **Zetta** como produtos separados dos pneus.
A consulta de pneus continua limitada à categoria `TIRE`, portanto uma referência de bateria nunca
aparece ao pesquisar uma medida de pneu.

## Pesquisa no WhatsApp

Pesquise sempre pela palavra `bateria` seguida da amperagem:

```text
bateria 60
```

O resultado reúne as baterias Moura e Zetta daquela amperagem. Outros formatos, como `60ah`,
`moura 60`, `zetta 60` ou somente o modelo, não iniciam uma pesquisa. Depois da consulta, os
mesmos comandos de venda, entrada, ajuste, preço, foto e localização continuam disponíveis.

## Preparação do PDF

O PDF recebido deve primeiro ser conferido e convertido para CSV. O importador não lê o PDF
diretamente; isso impede que textos de cabeçalho, rodapé ou observações sejam cadastrados como
produtos por engano.

O CSV usa as colunas abaixo:

```csv
reference,description,cash_price,credit_price,stock,category,battery_brand
M60GD,BATERIA 12V 60AH DIREITA,650.00,690.00,4,BATTERY,MOURA
Z100LE,BATERIA 12V 100AH ESQUERDA,980.00,1050.00,2,BATTERY,ZETTA
```

Para baterias:

- `category` deve ser sempre `BATTERY`;
- `battery_brand` aceita somente `MOURA` ou `ZETTA`;
- estoque deve ser um número inteiro igual ou maior que zero;
- preços devem ser informados em formato monetário, com no máximo duas casas decimais;
- cada produto novo precisa de uma decisão explícita `CREATE` no CSV de resolução.

## Importação segura

Primeiro execute somente a simulação:

```powershell
npm run sync:catalog -- data\seed\congo_battery_products.csv --resolution data\seed\congo_battery_catalog_resolution.csv
```

Confira a quantidade de produtos, marcas, referências, preços e estoque. A mensagem final deve
informar que nenhuma alteração foi feita. Somente depois do backup e da conferência, aplique:

```powershell
npm run sync:catalog -- data\seed\congo_battery_products.csv --resolution data\seed\congo_battery_catalog_resolution.csv --apply
```

O sincronizador preserva produtos que não estão no CSV, não renomeia itens existentes e bloqueia
a execução se categoria ou marca não corresponder ao cadastro já salvo.
