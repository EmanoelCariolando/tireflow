Estoque extraído de `BATERIAS 08.10.26.pdf`, coluna SALDO.

O CSV contém somente referência, descrição de identificação e estoque. Aplicar com
`npm run sync:stocks -- data/seed/congo_battery_stocks_2026-10-08.csv --apply`.

Incluídos os 13 modelos com correspondência inequívoca no cadastro existente.
Pendências/exclusões:

- Moura 50 Ah: PDF informa 3 unidades agregadas; aguarda distribuição entre M50JD, M50ED e M50EX.
- Zetta 50 Ah: PDF informa 4 unidades agregadas; cadastro já tem 2 Z50D e 2 Z50ED. Mantido até confirmação da distribuição.
- Moura 72 Ah (MF72LD): não consta no PDF; estoque existente preservado.
- Capacidades sem referência cadastrada, todas zeradas no PDF, não foram criadas.

Os preços do PDF não foram importados. O CSV de catálogo de setembro foi preservado como histórico.
