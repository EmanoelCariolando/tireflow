# Pneus de moto — Congo

O catálogo de 15/10/2026 está em:

`data/seed/congo_motorcycle_products_2026-10-15.csv`

Ele contém 46 modelos extraídos da relação `PNEUS MOTOS 15.10.26.pdf`. O importador atualiza
preço e estoque de cadastros já conhecidos, converte os pneus do catálogo anterior para a categoria
`MOTORCYCLE_TIRE` e cria somente os modelos novos. Identidade, foto e localização dos produtos
existentes são preservadas.

Com o serviço do Congo parado, confira sem alterar o banco:

```cmd
npm.cmd run import:motorcycle-tires
```

Depois aplique:

```cmd
npm.cmd run import:motorcycle-tires -- --apply
```

O comando é idempotente: uma segunda execução não duplica produtos.

## Consulta no WhatsApp

- `mt 21`: pneus de moto aro 21 com estoque maior que zero.
- `0 mt 21`: pneus de moto aro 21 com estoque zerado.

O mesmo formato funciona para qualquer aro cadastrado, por exemplo `mt 14`, `mt 17`, `mt 18`
e `mt 19`.
