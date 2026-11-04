# Regras financeiras

## Comissão de novas vendas

- Sem desconto: 2% sobre o total final da venda.
- Com desconto em percentual ou reais: 1% sobre o total final.
- Redução do valor de uma pendência também é desconto. A comparação usa o valor
  reservado da própria pendência, lido dentro da transação de conclusão.
- Se a pendência já tinha desconto, sua cotação original também é preservada na
  comparação: R$100 → R$90 → R$95 ainda paga 1%; voltar a R$100 sem novo desconto
  paga 2%. Um desconto adicional depois de negociar R$95 usa R$95 como base.
- Aumento de preço sem desconto mantém 2%.
- Baterias, câmaras e protetores mantêm a exceção de 1%; notas sem comissão
  permanecem com 0%.
- A taxa é registrada no movimento da venda; a regra nova não regrava vendas anteriores.

## Cotações e pendências

Uma sessão válida preserva a cotação selecionada, inclusive 10X, mesmo que o cadastro
seja alterado antes da confirmação. A confirmação continua validando a existência,
atividade do produto e disponibilidade de estoque. Uma cotação preservada não é
considerada desconto por ter ficado abaixo do novo preço de cadastro.

Alterar o total negociado de uma pendência modifica somente aquela negociação.
Os preços à vista e 10X cadastrados e os valores de vendas anteriores são preservados.
Após renegociar, descontos adicionais usam o novo total, com rateio em centavos.

## Vendas e confirmações repetidas

Cada sessão de venda recebe uma chave de operação. Movimentos e recibo da operação
são gravados na mesma transação. A repetição com a mesma chave e os mesmos valores
retorna o recibo original; valores diferentes são recusados. Falha ao enviar uma
resposta não desfaz a gravação. Quando o resultado da transação é incerto, a sessão
preserva a chave e permite repetir `confirmar` sem uma segunda baixa de estoque.
Após reinício do processo, o recibo continua persistido, mas a conversa em memória
não é restaurada automaticamente; iniciar uma nova sessão é uma nova operação.

## Estornos e devoluções físicas

Somente usuários já cadastrados com `role=ADMIN` e ativos podem consultar, preparar
ou confirmar operações financeiras. A autorização é revalidada na transação de
gravação. Os comandos não promovem nem cadastram administradores automaticamente.
Também se aplicam as restrições existentes do grupo oficial e do WhatsApp privado.

Use `financeiro` para ver os comandos, todos com confirmação e cancelamento:

- `estorno #V-000001`: consultar os itens e o saldo da venda.
- `estorno #V-000001 total motivo: cancelamento`: estornar todo o saldo financeiro,
  sem presumir recebimento físico.
- `estorno #V-000001 itens 2:3:1 motivo: devolução parcial`: estornar três unidades
  do item 2, das quais apenas uma foi recebida. Para vários itens, separar por vírgula.
- `retorno estorno #E-000001 2 1`: receber depois uma unidade do item 2 daquele
  estorno. A numeração dos itens é a mesma da venda, inclusive em estornos parciais.

O valor é calculado sobre a venda original, nunca sobre o preço atual do cadastro.
O rateio cumulativo conserva centavos: três unidades de uma venda de R$100,00
estornadas separadamente geram R$33,33, R$33,34 e R$33,33. Pagamentos mistos são
revertidos proporcionalmente ao saldo ainda não estornado de cada meio original;
nenhum meio fica negativo nem ultrapassa seu valor original. O registro contábil
não transfere dinheiro por PIX, cartão ou outro serviço.

A venda original permanece intacta. Cada estorno registra motivo, administrador,
data, chave, conteúdo da solicitação e itens vinculados aos movimentos originais.
Devoluções físicas têm registros e chaves próprios. Só quantidades efetivamente
recebidas incrementam o estoque, com movimento de ajuste vinculado ao estorno.
É possível devolver depois; isso não gera outro reembolso ou outra comissão.
Repetições com a mesma chave retornam o registro existente; conflitos e quantidades
acima dos saldos são recusados. Toda operação é atômica.

## Fechamento explícito e comissão paga

- `fechar mes 10/2026`: preparar e confirmar um mês já encerrado no calendário.
- `fechamento 10/2026`: consultar valores congelados e situação de pagamento.
- `pagar comissao 10/2026 1`: marcar como paga a comissão integral do vendedor 1
  exibido no fechamento, com registro do administrador e data. É o registro de um
  pagamento já efetuado, sem transferência de dinheiro. Só aceita saldo positivo.

O envio automático de um relatório não fecha o mês nem comprova pagamento.
Relatórios de comissão sem fechamento são identificados como prévia. O fechamento
guarda os valores e textos imutáveis; marcar pagamento modifica apenas a situação
de pagamento. Confirmações repetidas retornam o mesmo fechamento/pagamento.

A comissão bruta arredonda uma vez por vendedor, com centavos distribuídos entre
os movimentos para permitir reversão exata. O estorno gera um ajuste negativo
proporcional à comissão congelada daquela venda, inclusive quando ela já foi paga.
O ajuste é usado uma única vez no próximo fechamento explícito elegível, sem
alterar o fechamento de origem. A data do estorno permanece no registro; sua
receita negativa pertence ao mês em que ele ocorreu. O acerto de comissão no
próximo fechamento é separado dessa competência do faturamento.

Para estornar uma venda de outro mês ainda sem fechamento registrado, deve-se
fechar primeiro o mês de origem antes de concluir o fechamento que apurará o
ajuste. Isso estabelece a base de centavos da comissão sem presumir pagamentos
históricos. Saldo negativo é exibido como ajuste a compensar, sem ser marcado pago.

## Instalação

A migração `20261102000000_add_sale_reversals_and_financial_closings` apenas adiciona
tabelas e vínculos; não regrava preços ou vendas anteriores. Foi preparada localmente
e só deve ser aplicada ao banco da instalação em uma etapa futura autorizada, com
backup próprio. Os testes usam bancos SQLite descartáveis e exemplos sintéticos;
nenhuma migração deve ser aplicada ao banco real para executar os testes.
