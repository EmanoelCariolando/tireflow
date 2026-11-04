# Validação e ativação financeira

Esta etapa autoriza apenas ensaios locais com dados sintéticos e bancos descartáveis.
Não autoriza migrar a instalação, reiniciar o bot ou acessar produção.

## Cobertura funcional

O teste `financialWorkflow.integration.test.ts` envia mensagens simuladas pelo
roteador do bot, usando os comandos reais de preço, venda, desconto, fechamento,
pagamento de comissão, estorno e recebimento físico. Não inicializa um cliente
WhatsApp nem utiliza autenticação existente.

O roteiro confere o preço à vista de R$200 com 10x total de R$218,40, sem acréscimo
duplicado e sem alterar o 10x de outro produto. Confere vendas a 2%, desconto a 1%,
cotação de sessão preservada, fechamento de R$998,40 e comissão de R$18,17. Após
registrar esse pagamento e estornar R$780,00 no mês seguinte, uma nova comissão de
R$20,00 recebe ajuste de -R$13,80, resultando em R$6,20 a pagar. O fechamento anterior
e as vendas originais permanecem iguais; o estoque volta apenas pelo recebido.

Os testes financeiros existentes completam a cobertura com pendências, descontos
adicionais, categorias com comissão especial, notas sem comissão, pagamentos mistos,
centavos, autorização, repetição de mensagens, resultado incerto após COMMIT,
devoluções posteriores e relatórios mensais em processo UTC.

## Migração e dados anteriores

O teste `financialMigrationRollback.integration.test.ts` monta o banco usando apenas
as migrações anteriores à financeira. Reconstrói o schema e gera o cliente Prisma
anterior em diretório temporário, sem instalar dependências. O ensaio inclui campos
antigos nulos de comissão e agrupamento, produto com 10x importado independente,
produto sem 10x, categoria com comissão especial e nota isenta.

A migração financeira deve criar somente suas tabelas e índices. Os registros de
todas as tabelas antigas são comparados antes/depois; a repetição da migração,
integridade SQLite e chaves estrangeiras são verificadas. Não há atualização de
produtos em massa nem recalculo retroativo de vendas.

Uma venda antiga sem detalhamento válido de pagamento permanece preservada, mas
seu estorno é recusado. Esses casos exigem conferência e uma decisão específica de
regularização, sem inventar o meio do reembolso. Comissão ou pagamento histórico
não documentados também não são presumidos: devem ser conferidos antes de registrar
o fechamento e marcar pagamento.

## Procedimento de ativação, somente após nova autorização

1. Reservar janela sem operações. Identificar a versão anterior exata, seus
   artefatos compilados, cliente Prisma e migrações. Conferir administradores
   ativos, filial e destino configurado, sem expor credenciais. Em produção,
   `ALLOW_PRIVATE_TEST_MODE` deve estar explicitamente `false`.
2. Com nova autorização para a intervenção, parar o bot e tarefas que escrevem no
   banco. Confirmar ausência de outra instância e de gravações concorrentes.
3. Criar backup consistente do SQLite e das fotos com a ferramenta compatível com
   o schema ainda instalado. Validar integridade, manifesto, filial e restauração
   em cópia separada. Preservar os artefatos anteriores e o backup fora da pasta
   que será atualizada. Não copiar ou trocar autenticação WhatsApp nesta operação.
4. Preparar a nova versão separadamente, com dependências travadas e cliente Prisma
   gerado para o schema novo e o sistema operacional de destino. Executar typecheck,
   testes e build antes de substituir a versão em uso. Não executar importadores,
   seeds, reset ou atualização de preços em massa.
5. Na versão nova e no destino previamente conferido, aplicar somente as migrações
   pendentes com `prisma migrate deploy`, nunca `migrate dev`, `reset` ou `db push`.
   Conferir status, integridade, chaves estrangeiras e ausência de mudanças nos
   preços e nas vendas antigas. Manter o bot parado se qualquer verificação falhar.
6. Realizar a conferência de fechamento/pagamentos históricos com o administrador.
   Só iniciar uma única instância mediante autorização da etapa de ativação.
   Conferir conexão, autorização e relatórios antes de liberar gravações. Não
   registrar vendas fictícias no banco real para fazer um teste de funcionamento.

## Rollback e recuperação

Não existe migração automática de descida. Não apagar as tabelas financeiras para
simular rollback: isso elimina vínculos de estornos, pagamentos e ajustes.

- Antes de liberar novas gravações, pode-se retornar ao conjunto anterior de
  código, cliente, schema e backup verificado, durante a janela autorizada.
- O restaurador novo recusa backup com schema antigo. Usar a ferramenta que
  corresponde às migrações e ao cliente do backup. O ensaio verifica essa recusa e
  a restauração com as ferramentas reconstruídas para o schema anterior.
- Após operações novas, trocar apenas o código é inseguro: a versão anterior não
  conhece o livro de estornos/ajustes. Restaurar o backup prévio também descarta as
  operações feitas desde ele. Bloquear novas gravações, preservar um backup do
  estado novo e reconciliar essa janela antes de qualquer retorno autorizado,
  incluindo comissões já pagas, ajustes e devoluções recebidas. Manter essa cópia
  auditável do estado novo; retornar ao código antigo não elimina essas obrigações.
- Para recuperar operações financeiras já registradas, preferir corrigir a versão
  nova ou restaurar um backup completo do schema novo, com código/cliente novos.
  O teste confere que esse backup recupera estoque, estornos, pagamentos, ajustes,
  fechamentos e fotos, não apenas as vendas originais.

O ensaio usa dados sintéticos; não certifica o conteúdo do banco real nem um pacote
antigo de produção. O transporte WhatsApp ao vivo e múltiplas instâncias simultâneas
permanecem fora desta validação.
