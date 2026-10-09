Fonte: `PNEUS MOTOS, CAM DE AR 08.10.26.pdf`, páginas 2 e 3.

Importação exclusiva das linhas CAM MOTO, CAM CARRO e CAM AGRICOLA.
A última coluna é o saldo. A primeira coluna monetária foi usada como preço a prazo,
e a segunda como preço à vista, seguindo o catálogo existente (diferença de 5,8%).
O cabeçalho interno das câmaras mantém a data 09/06/2026.

- MOTORCYCLE_INNER_TUBE: 15 modelos, 253 unidades; consulta `camara mt`.
- INNER_TUBE: 67 modelos, 103 unidades; consulta `camara`.
- Consulta de zerados: `0 camara mt` e `0 camara`.

Conferir: `npx tsx src/database/importInnerTubes.ts`.
Aplicar: `npx tsx src/database/importInnerTubes.ts --apply`.
Reexecuções preservam os produtos já importados, incluindo vendas e alterações posteriores.

As descrições foram preservadas como no PDF. As referências técnicas incluem um
sufixo estável para distinguir medidas com pontuação diferente.
As novas categorias usam a coluna textual existente do SQLite; basta regenerar o
Prisma Client e compilar o projeto, sem alterar a estrutura do banco.
