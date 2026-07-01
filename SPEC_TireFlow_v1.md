# TireFlow — SPEC v1.0

## 1. Visão Geral

**TireFlow** é um sistema de controle de estoque e vendas de pneus via WhatsApp.

O objetivo é substituir o processo atual baseado em caderno + Excel, permitindo que vendedores consultem pneus, registrem vendas, entradas e ajustes diretamente pelo WhatsApp.

O patrão/gestor recebe notificações privadas em tempo real sobre vendas, entradas e ajustes importantes.

### Proposta de valor

> Controlar vendas e estoque de pneus em tempo real pelo WhatsApp, sem depender de caderno ou atualização manual em Excel.

---

## 2. Problema Atual

Atualmente o fluxo pode ser assim:

1. Cliente compra ou consulta pneu.
2. Funcionário anota a saída em um caderno.
3. Depois alguém atualiza o Excel manualmente.
4. Se alguém esquecer de anotar, anotar errado ou atualizar depois, o estoque fica incorreto.

Consequências:

- Pneus podem “sumir”.
- Estoque físico não bate com o Excel.
- Patrão precisa conferir manualmente.
- Vendedores perdem tempo procurando preço e quantidade.
- Gestor não acompanha tudo em tempo real quando está viajando.

---

## 3. Objetivo do MVP

Criar uma primeira versão funcional com foco em:

- Consulta rápida de pneus.
- Venda com confirmação.
- Atualização automática do estoque.
- Registro de entrada de estoque.
- Notificação privada para o patrão.
- Menu simples de estoque.
- Controle mínimo de permissões.
- Registro de movimentações para auditoria interna.

---

## 4. Stack Recomendada

### Backend

- Node.js
- TypeScript
- Express
- SQLite no MVP
- Prisma ORM
- whatsapp-web.js para testes locais

### Futuro

- PostgreSQL
- Docker
- API oficial do WhatsApp Business
- Dashboard Web

---

## 5. Conceitos Principais

### Produto/Pneu

Um pneu deve possuir:

- id
- reference
- description
- estoque atual
- preço à vista
- preço a prazo
- estoque mínimo
- ativo/inativo
- data de criação
- data de atualização

**Definições importantes para carga inicial via CSV:**

- `reference`: representa a medida do pneu (exemplo: `175/70 R14`)
- `description`: representa a descrição comercial / modelo do produto (exemplo: `SPEEDMAX STREET MH01`)

Exemplo:

- Reference: 175/70 R14
- Descrição: SpeedMax Street MH01
- Estoque: 12
- À vista: R$ 320,00
- A prazo: R$ 350,00

---

## 6. Usuários

No MVP, as permissões serão definidas exclusivamente pelo status de administrador do grupo do WhatsApp.

### Usuário comum

Pode:

- Consultar pneus.
- Registrar venda.

### Administrador do grupo

Pode:

- Consultar pneus.
- Registrar venda.
- Registrar entrada.
- Ajustar estoque.
- Alterar preços.
- Acessar relatórios.

### Observação sobre evolução de permissões

A tabela users permanece na arquitetura apenas para permitir uma futura evolução para um sistema próprio de autenticação e permissões, sem necessidade de alterar a estrutura do projeto.

---

## 7. Comandos do WhatsApp

### 7.1 Consulta de pneu

Comando:

```text
pneu 175/70/14
```

O sistema deve aceitar variações:

```text
pneu 175/70/14
pneu 175 70 14
pneu 175-70-14
pneu 175/70 R14
```

Todas devem ser normalizadas para:

```text
175/70 R14
```

Resposta:

```text
🛞 175/70 R14

1️⃣ SpeedMax Street MH01
📦 Estoque: 12
💰 À vista: R$320,00
💳 A prazo: R$350,00

2️⃣ Pirelli Cinturato P7
📦 Estoque: 8
💰 À vista: R$395,00
💳 A prazo: R$430,00

3️⃣ Goodyear Assurance
📦 Estoque: 15
💰 À vista: R$380,00
💳 A prazo: R$410,00

Para vender:
venda 1 5
```

Regra importante:

- Consulta não inicia operação obrigatória.
- Se o usuário não responder nada, nada acontece.
- Se o usuário fizer outra consulta, o bot responde a nova consulta.
- A última consulta do usuário fica salva por 5 minutos apenas para permitir venda por índice, como `venda 1 5`.

---

### 7.2 Venda depois da consulta

Comando:

```text
venda 1 5
```

Significa:

- opção 1 da última consulta
- quantidade 5

O bot pergunta:

```text
Forma de pagamento?

1️⃣ À vista
2️⃣ A prazo
```

Usuário responde:

```text
1
```

Depois o bot pergunta:

```text
Observação?
Ex: Prefeitura de Congo

Digite: pular
```

Usuário pode responder:

```text
Prefeitura de Congo
```

ou:

```text
pular
```

Depois o bot mostra:

```text
⚠️ Confirmar venda?

Produto: 175/70 R14
Descrição: SpeedMax Street MH01
Quantidade: 5
Valor unitário: R$320,00
Total da venda: R$1.600,00
Obs: Prefeitura de Congo

Digite: confirmar ou cancelar
```

Após `confirmar`, o sistema:

1. Confere o estoque novamente.
2. Baixa o estoque.
3. Registra a venda.
4. Envia mensagem no grupo.
5. Envia notificação privada para o patrão.

Mensagem no grupo:

```text
✅ Venda registrada

Movimentação: #V-000153
Produto: 175/70 R14
Descrição: SpeedMax Street MH01
Quantidade: 5
Valor unitário: R$320,00
Total da venda: R$1.600,00
Vendedor: João
Obs: Prefeitura de Congo

Estoque atual: 7
```

Mensagem privada para o patrão:

```text
🔔 Nova venda

Movimentação: #V-000153
João vendeu 5 pneus
175/70 R14 SpeedMax Street MH01

Valor unitário: R$320,00
Total da venda: R$1.600,00
Obs: Prefeitura de Congo
Estoque atual: 7
```

Regra de cálculo:

O total da venda deve ser calculado automaticamente:

```text
quantidade × valor unitário
```

Exemplo:

```text
Quantidade: 2
Valor unitário: R$200,00
Total da venda: R$400,00
```

---

### 7.3 Alteração de Preços

Permissão:

- Apenas administradores do grupo do WhatsApp.

Comando (após consulta de pneu, seguindo o mesmo padrão da venda):

```text
preco 1
```

Significa:

- opção 1 da última consulta

Fluxo:

- informar a medida (via comando `pneu ...`);
- o bot lista os produtos encontrados numerados;
- o usuário escolhe o produto pelo número da lista (ex: `preco 1`);
- informar novo preço à vista;
- informar novo preço a prazo;
- confirmação;
- atualizar os preços;
- notificar o patrão.

Exemplo de fluxo após `pneu 175/70 R14`:

O bot lista os produtos numerados (como na consulta).

Usuário escolhe:

```text
preco 1
```

Bot pergunta:

```text
Novo preço à vista?

Digite o valor (ex: 335.50)
```

Usuário responde:

```text
335.50
```

Bot pergunta:

```text
Novo preço a prazo?

Digite o valor (ex: 365.00)
```

Usuário responde:

```text
365.00
```

Bot mostra:

```text
⚠️ Confirmar alteração de preço?

Produto: 175/70 R14
Descrição: SpeedMax Street MH01

Preço à vista anterior: R$320,00
Novo preço à vista: R$335,50

Preço a prazo anterior: R$350,00
Novo preço a prazo: R$365,00

Responsável: João

Digite: confirmar ou cancelar
```

Após `confirmar`, o sistema:

1. Atualiza os preços do produto.
2. Registra a movimentação de alteração de preço (com preços antigos e novos).
3. Envia mensagem no grupo.
4. Envia notificação privada para o patrão.

Mensagem no grupo:

```text
✅ Preço alterado

Movimentação: #P-000156
Produto: 175/70 R14
Descrição: SpeedMax Street MH01

À vista: R$320,00 → R$335,50
A prazo: R$350,00 → R$365,00
Responsável: João
Data/Hora: 28/06/2026 14:32

Estoque atual: 12
```

Mensagem privada para o patrão:

```text
🔔 Alteração de preço

Movimentação: #P-000156
João alterou preços de 175/70 R14 SpeedMax Street MH01

À vista: R$320,00 → R$335,50
A prazo: R$350,00 → R$365,00

Data/Hora: 28/06/2026 14:32
```

Regras:

- Registrar responsável.
- Registrar data/hora.
- Registrar preços antigo e novo.
- Permitir cancelar a qualquer momento.
- Timeout de 5 minutos.
- Confirmação obrigatória (preços só atualizam após `confirmar`).

---

## 8. Menu de Estoque

Permissão:

- Apenas administradores do grupo do WhatsApp.

Comando:

```text
estoque
```

Resposta:

```text
📦 Menu de Estoque

1️⃣ Entrada
2️⃣ Baixo estoque
3️⃣ Mais vendidos
4️⃣ Todos os pneus
5️⃣ Relatório do dia
6️⃣ Ajuste de estoque
7️⃣ Alterar preços
```

O usuário pode digitar o número ou o comando direto:

```text
baixo
mais vendidos
entrada
ajuste
preco
```

---

## 9. Entrada de Estoque

Comando:

```text
entrada <número>
```

Permissão:

- Apenas administradores do grupo do WhatsApp.

Fluxo:

1. Usuário executa `pneu <medida>`.
2. O bot lista os produtos numerados.
3. Usuário envia `entrada <número>`.
4. Bot solicita a quantidade.
5. Bot solicita o fornecedor.
6. Bot exibe confirmação.
7. Após confirmar, registra a entrada.

Confirmação:

```text
⚠️ Confirmar entrada?

Produto: 175/70 R14
Descrição: SpeedMax Street MH01
Quantidade: +20
Fornecedor: ABC Pneus

Digite: confirmar ou cancelar
```

Após confirmar:

```text
📦 Entrada registrada

Movimentação: #E-000154
Produto: 175/70 R14
Descrição: SpeedMax Street MH01
Quantidade: +20
Fornecedor: ABC Pneus
Responsável: Carlos

Estoque atual: 27
```

O patrão recebe no privado:

```text
📦 Nova entrada

Movimentação: #E-000154
Carlos registrou entrada de 20 pneus
175/70 R14 SpeedMax Street MH01

Fornecedor: ABC Pneus
Estoque atual: 27
```

---

## 10. Ajuste de Estoque

Comando:

```text
ajuste <número>
```

Permissão:

- Apenas administradores do grupo do WhatsApp.

Fluxo:

1. Usuário executa `pneu <medida>`.
2. O bot lista os produtos numerados.
3. Usuário envia `ajuste <número>`.
4. Bot solicita o novo estoque.
5. Bot solicita o motivo.
6. Bot exibe confirmação.
7. Após confirmar, registra o ajuste.

Confirmação:

```text
⚠️ Confirmar ajuste?

Produto: 175/70 R14
Descrição: SpeedMax Street MH01
Estoque anterior: 12
Novo estoque: 10
Motivo: Conferência semanal

Digite: confirmar ou cancelar
```

Após confirmar:

```text
⚠️ Ajuste registrado

Movimentação: #A-000155
Produto: 175/70 R14
Descrição: SpeedMax Street MH01
Anterior: 12
Atual: 10
Responsável: João
Motivo: Conferência semanal
```

Patrão recebe no privado.

---

## 11. Baixo Estoque

Permissão:

- Apenas administradores do grupo do WhatsApp.

Comando:

```text
baixo
```

Resposta:

```text
⚠️ Produtos abaixo do mínimo

175/70 R14 SpeedMax Street MH01
Estoque: 3
Mínimo: 5

205/55 R16 Pirelli Cinturato P7
Estoque: 2
Mínimo: 5
```

---

## 12. Mais Vendidos

Permissão:

- Apenas administradores do grupo do WhatsApp.

Comando:

```text
mais vendidos
```

Resposta:

```text
🏆 Mais vendidos

1º 175/70 R14 SpeedMax Street MH01
132 unidades

2º 205/55 R16 Pirelli Cinturato P7
95 unidades

3º 185/65 R15 Goodyear Assurance
81 unidades
```

---

## 13. Relatório Diário

Comando:

```text
relatorio hoje
```

Permissão:

- Apenas administradores do grupo do WhatsApp.

Também pode ser enviado automaticamente para o patrão no fim do dia.

Resposta:

```text
📊 Resumo do Dia

Entradas: 42 pneus
Saídas: 37 pneus
Faturamento à vista: R$12.800,00
Faturamento a prazo: R$8.630,00
Total geral: R$21.430,00

Mais vendido:
175/70 R14 SpeedMax Street MH01

Produtos em baixo estoque:
3
```

---

## 14. Regras Anti-Bug

### 14.1 Consulta não trava o bot

A consulta apenas mostra dados. Ela não deixa o bot esperando resposta obrigatória.

### 14.2 Última consulta expira

A última consulta fica salva por 5 minutos. Depois disso, comandos que dependem da última consulta, como `venda 1 5`, `entrada 1` e `ajuste 1`, devem retornar:

```text
⚠️ Consulta expirada.

Pesquise novamente:
pneu 175/70/14
```

### 14.3 Venda só baixa estoque após confirmação

Nenhuma venda altera estoque antes da mensagem `confirmar`.

### 14.4 Conferência dupla de estoque

No momento de confirmar venda, o sistema confere o estoque novamente.

Se não houver estoque suficiente:

```text
⚠️ Venda cancelada.

Estoque atual: 3
Quantidade solicitada: 5
```

### 14.5 Uma operação por usuário

Cada usuário pode ter apenas uma operação em andamento.

Operações:

- venda aguardando forma de pagamento
- venda aguardando observação
- entrada em andamento
- ajuste em andamento
- alteração de preço em andamento

Se o usuário tentar iniciar outra operação:

```text
⚠️ Você possui uma operação em andamento.

Digite: confirmar ou cancelar
```

### 14.6 Cancelamento

Durante qualquer operação:

```text
cancelar
```

Resposta:

```text
❌ Operação cancelada.
```

### 14.7 Timeout

Operações expiram após 5 minutos sem resposta.

Resposta:

```text
⏳ Operação cancelada por inatividade.
```

### 14.8 Idempotência

O sistema deve evitar registrar a mesma venda duas vezes se o usuário enviar `confirmar` repetidamente.

Cada operação deve ter um ID interno único.

### 14.9 Movimentação única

Cada venda, entrada, ajuste ou alteração de preço deve gerar um código:

- Venda: `#V-000001`
- Entrada: `#E-000001`
- Ajuste: `#A-000001`
- Alteração de preço: `#P-000001`

### 14.10 Grupo oficial e comunicação do bot

No MVP, o TireFlow só deve aceitar comandos enviados dentro do grupo oficial do atacadão.

O grupo oficial será identificado por configuração do sistema.

Todos os comandos operacionais devem funcionar somente no grupo oficial do atacadão:

- `pneu`
- `venda`
- `entrada`
- `ajuste`
- `preco`
- `baixo`
- `mais vendidos`
- `relatorio hoje`
- `estoque`

Regras:

- Mensagens privadas recebidas pelo bot devem ser ignoradas.
- Mensagens de outros grupos devem ser ignoradas.
- Comandos só são processados no grupo autorizado.
- Notificações privadas para o patrão continuam permitidas.

Notificações:

- Após confirmar uma venda no grupo, o bot deve enviar automaticamente uma notificação privada ao patrão.
- Após confirmar uma entrada no grupo, o bot deve enviar automaticamente uma notificação privada ao patrão.
- Após confirmar um ajuste de estoque no grupo, o bot deve enviar automaticamente uma notificação privada ao patrão.
- Após confirmar uma alteração de preço no grupo, o bot deve enviar automaticamente uma notificação privada ao patrão.

Observação:

O patrão recebe as notificações no WhatsApp privado, enquanto toda a operação acontece exclusivamente no grupo oficial do atacadão.

Observação de implementação:

- Na Fase 3, preparar a validação do grupo autorizado no `messageHandler`.
- O bot deve aceitar comandos apenas do grupo oficial configurado.
- Em desenvolvimento, permitir modo de teste por variável de ambiente para testar no privado.
- O ID do grupo oficial deve vir do `.env`.
- O número privado do patrão deve vir do `.env`.
- A notificação privada ao patrão deve ser implementada apenas nas fases em que a operação real existir.
- Venda real: Fase 7.
- Entrada real: Fase 8.
- Ajuste real: Fase 9.
- Alteração de preço real: Fase 10.

---

## 15. Banco de Dados — Modelo Inicial

### users

- id
- name
- phone
- role
- isActive
- createdAt
- updatedAt

### products

- id
- reference
- description
- stock
- minStock
- cashPrice
- creditPrice
- isActive
- createdAt
- updatedAt

> **Nota:** O campo `description` armazena a descrição comercial completa do pneu (ex: "SpeedMax Street MH01"). Não existe campo separado de marca no modelo inicial, pois o CSV de carga não fornece marca de forma confiável e isolada.

> **Nota:** A população inicial desta tabela será feita via script de seed (ver Fase 5 — Seed inicial de produtos via CSV). Após a carga inicial, o estoque só é alterado via WhatsApp.

### movements

- id
- code
- type
- productId
- userId
- quantity
- previousStock
- newStock
- unitPrice
- totalValue
- paymentMethod
- observation
- supplier
- reason
- createdAt

Tipos de movimentação:

- SALE
- ENTRY
- ADJUSTMENT
- PRICE_CHANGE

O tipo `PRICE_CHANGE` representa alterações de preço realizadas pelo comando `preco`.

### user_sessions

- id
- userId
- chatId
- type
- step
- payloadJson
- expiresAt
- createdAt
- updatedAt

Usado para guardar operações em andamento.

### search_sessions

- id
- userId
- chatId
- resultsJson
- expiresAt
- createdAt

Usado para permitir `venda 1 5` após uma consulta.

---

## 16. Arquitetura Recomendada

```text
data/
  seed/
    initial_products.csv     # Arquivo de carga inicial (executado uma única vez)

src/
  app.ts
  server.ts

  config/
    env.ts

  whatsapp/
    client.ts
    messageHandler.ts

  commands/
    tireSearchCommand.ts
    saleCommand.ts
    stockMenuCommand.ts
    entryCommand.ts
    adjustmentCommand.ts
    lowStockCommand.ts
    bestSellersCommand.ts
    reportCommand.ts
    priceCommand.ts

  services/
    productService.ts
    saleService.ts
    entryService.ts
    adjustmentService.ts
    notificationService.ts
    sessionService.ts
    reportService.ts
    priceService.ts

  repositories/
    productRepository.ts
    userRepository.ts
    movementRepository.ts
    sessionRepository.ts

  utils/
    normalizeTireSize.ts
    formatCurrency.ts
    generateMovementCode.ts

  database/
    prisma.ts
```

Regra:

- `messageHandler` apenas identifica comandos.
- `commands` lidam com fluxo de conversa.
- `services` contêm regras de negócio.
- `repositories` acessam o banco.
- `utils` cuidam de funções pequenas e reutilizáveis.

Regra adicional:
- A pasta `data/seed/` contém arquivos de carga inicial e **não** faz parte da rotina diária do sistema. O seed deve ser executado manualmente apenas uma vez após a criação do banco.

---

## 17. Ordem de Desenvolvimento

### Fase 1 — Base

1. Criar projeto Node + TypeScript.
2. Configurar WhatsApp.
3. Criar comando `ping`.
4. Criar estrutura de pastas.

### Fase 2 — Consulta fake

1. Criar lista fake de pneus.
2. Implementar `pneu 175/70/14`.
3. Normalizar medidas.
4. Salvar última consulta em memória.

### Fase 3 — Venda fake

1. Implementar `venda 1 5`.
2. Perguntar forma de pagamento.
3. Perguntar observação.
4. Confirmar venda.
5. Simular baixa de estoque.

Observação:

- Preparar a validação do grupo autorizado no `messageHandler`.
- O bot deve aceitar comandos apenas do grupo oficial configurado.
- Em desenvolvimento, permitir modo de teste por variável de ambiente para testar no privado.
- O ID do grupo oficial deve vir do `.env`.
- O número privado do patrão deve vir do `.env`.

### Fase 4 — Banco Prisma + SQLite

1. Configurar Prisma + SQLite.
2. Criar tabelas.
3. Trocar dados fake por banco.

### Fase 5 — Seed inicial de produtos via CSV

1. Criar pasta `data/seed/`.
2. Colocar o arquivo `initial_products.csv` contendo os seguintes campos (provenientes do CSV de carga inicial):
   - `reference` (medida do pneu, ex: 175/70 R14)
   - `description` (descrição comercial/modelo, ex: SPEEDMAX STREET MH01)
   - `cash_price`
   - `credit_price`
   - `stock`
3. Criar script de seed (executado manualmente uma única vez).
4. O script deve:
   - Validar os dados do CSV antes da importação.
   - Evitar cadastrar produtos duplicados.
   - Gerar relatório final da importação (quantidade importada, duplicados ignorados, erros).
5. Após a execução do seed, o estoque passa a ser controlado exclusivamente pelo WhatsApp.

**Importante:**
- Este seed é executado **uma única vez** para carga inicial.
- O CSV define a estrutura inicial dos produtos usando `reference` + `description` (sem campo separado de marca).
- Não é rotina de atualização de estoque.
- Não deve ser usado para importação recorrente de planilhas.
- Após a carga, qualquer alteração de estoque (vendas, entradas, ajustes) deve ocorrer apenas via WhatsApp.

### Fase 6 — Consulta real no banco

1. Implementar busca real de produtos no banco.
2. Substituir lista fake por consulta ao banco.

### Fase 7 — Venda real

1. Registrar venda no banco.
2. Baixar estoque.
3. Registrar movimentação.
4. Enviar notificação privada para o patrão. (Implementar notificação privada na Fase 7, quando a venda real existir.)

### Fase 8 — Entrada

1. Implementar comando `entrada`.
2. Registrar entrada no banco.
3. Notificar patrão. (Implementar notificação privada na Fase 8, quando a entrada real existir.)

### Fase 9 — Ajuste

1. Implementar comando `ajuste`.
2. Validar permissão.
3. Registrar motivo.
4. Notificar patrão. (Implementar notificação privada na Fase 9, quando o ajuste real existir.)

### Fase 10 — Alteração de Preços

1. Implementar `preco <número>` após consulta (seguindo o mesmo padrão da venda).
2. Informar medida (via `pneu`), bot lista produtos numerados.
3. Usuário escolhe produto pelo número da lista.
4. Informar novo preço à vista.
5. Informar novo preço a prazo.
6. Exibir confirmação com preços antigos e novos.
7. Registrar responsável, data/hora, preços antigo e novo.
8. Atualizar preços somente após confirmação obrigatória.
9. Permitir cancelar.
10. Aplicar timeout de 5 minutos.
11. Notificar o patrão. (Implementar notificação privada na Fase 10, quando a alteração de preço real existir.)

### Fase 11 — Relatórios

1. Baixo estoque.
2. Mais vendidos.
3. Relatório diário.

---

## 18. Prompt para IA

Use este prompt em outra IA antes de gerar código:

```text
Você é um Engenheiro de Software Sênior especializado em Node.js, TypeScript, Prisma, SQLite e bots de WhatsApp.

Leia a SPEC completa antes de escrever qualquer código.

Regras obrigatórias:

1. Não gere o projeto inteiro de uma vez.
2. Trabalhe por fases.
3. Antes de criar arquivos, explique o que será criado.
4. Use arquitetura modular.
5. Não coloque regra de negócio no arquivo principal.
6. Use TypeScript.
7. Use nomes em inglês no código.
8. Mensagens do bot devem ficar em português.
9. Sempre implemente testes manuais simples para validar cada fase.
10. Sempre que terminar uma fase, pare e espere minha confirmação.
11. Não implemente funcionalidades fora da SPEC sem pedir autorização.
12. Priorize código simples, legível e fácil de manter.
13. Garanta que consulta de pneus não prenda o bot em uma operação.
14. Garanta que venda só baixe estoque após confirmação.
15. Garanta que a última consulta expire após 5 minutos.
16. Garanta que exista cancelamento e timeout para operações.
17. Garanta que o sistema confira o estoque novamente antes de confirmar venda.
18. Garanta que o patrão receba notificação privada de venda, entrada e ajuste.

Comece apenas pela Fase 1:
- criar projeto Node + TypeScript
- instalar dependências
- criar estrutura inicial de pastas
- criar comando ping
- explicar como executar

Não avance para a Fase 2 sem minha confirmação.
```

---

## 19. Critério de Sucesso do MVP

O MVP será considerado funcional quando:

1. O vendedor consultar pneu pelo WhatsApp.
2. O bot mostrar produtos (descrição), estoque e preços.
3. O vendedor registrar uma venda.
4. O estoque baixar automaticamente.
5. A venda aparecer no grupo.
6. O patrão receber no privado.
7. Entrada de estoque funcionar.
8. Ajuste de estoque funcionar apenas para administradores do grupo do WhatsApp.
9. Baixo estoque e relatório diário funcionarem.
10. O sistema não ficar preso em consultas.
