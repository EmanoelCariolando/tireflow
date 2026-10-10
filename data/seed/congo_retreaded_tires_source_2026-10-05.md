Fonte: `PNEUS COBERTOS, CAM DE AR 05.10.26.pdf`.

CSV de conferência, ainda não importado. As três colunas monetárias foram preservadas
na ordem do PDF; as duas primeiras não têm cabeçalho identificável no texto extraído.
Nenhuma delas deve ser escolhida automaticamente como preço a prazo.

- Moto: 7 linhas, 5 unidades. Consulta preparada: `coberto mt`.
- Demais: 44 linhas, 25 unidades. Consulta preparada: `coberto`.
- Zerados: `0 coberto mt` e `0 coberto`.
- 34 linhas dos demais não possuem preço e têm saldo zero; ficam pendentes de preços, sem atribuir valor zero artificialmente.
- `P16 COBERTO 295 80 22.5 DIR` aparece duas vezes: 4 unidades / 1149.00 à vista e 2 unidades / 1199.00 à vista. Aguarda identificação dos modelos antes do cadastro.

Novas categorias: RETREADED_TIRE e MOTORCYCLE_RETREADED_TIRE.
O SQLite já armazena category como texto; regenerar Prisma Client e compilar é suficiente para os novos valores.
