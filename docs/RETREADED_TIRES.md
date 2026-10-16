# Pneus cobertos — Congo

O catálogo revisado de 15/10/2026 está em:

`data/seed/congo_retreaded_tires_2026-10-15.csv`

Foram incluídos os 17 modelos do PDF que possuem os três preços preenchidos: 7 de moto e
10 de carros/máquinas. As 34 linhas zeradas sem preço não foram transformadas em produtos,
evitando cadastros que poderiam ser vendidos sem um valor válido.

O saldo final da coluna da direita foi usado como estoque. Por isso, o modelo
`P16 COBERTO 750 16 TRAZ` entra com 4 unidades, depois da saída de 2 indicada na planilha.

Com o serviço do Congo parado, confira sem alterar o banco:

```cmd
npm.cmd run import:retreaded-tires
```

Depois aplique:

```cmd
npm.cmd run import:retreaded-tires -- --apply
```

O importador pode ser executado novamente sem duplicar produtos e preserva a identidade,
foto e localização de cadastros existentes.

## Consulta no WhatsApp

- `coberto`: carros e máquinas com estoque positivo.
- `coberto mt`: motos com estoque positivo.
- `0 coberto`: carros e máquinas zerados.
- `0 coberto mt`: motos zerados.
