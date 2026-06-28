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
- medida
- marca
- estoque atual
- preço à vista
- preço a prazo
- estoque mínimo
- ativo/inativo
- data de criação
- data de atualização

Exemplo:

- Medida: 175/70 R14
- Marca: SpeedMax
- Estoque: 12
- À vista: R$ 320,00
- A prazo: R$ 350,00

---

## 6. Usuários

Tipos de usuário:

### Vendedor

Pode:

- Consultar pneus.
- Registrar venda.

Não pode:

- Ajustar estoque manualmente.
- Alterar preço.
- Cadastrar produtos.

### Estoquista

Pode:

- Consultar pneus.
- Registrar entrada de estoque.

### Gerente

Pode:

- Consultar pneus.
- Registrar venda.
- Registrar entrada.
- Ajustar estoque.
- Ver relatórios.

### Patrão/Admin

Pode tudo.

Também recebe notificações privadas.

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

1️⃣ SpeedMax
📦 Estoque: 12
💰 À vista: R$320,00
💳 A prazo: R$350,00

2️⃣ Pirelli
📦 Estoque: 8
💰 À vista: R$395,00
💳 A prazo: R$430,00

3️⃣ Goodyear
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
Marca: SpeedMax
Quantidade: 5
Total: R$1.600,00
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
Marca: SpeedMax
Quantidade: 5
Total: R$1.600,00
Vendedor: João
Obs: Prefeitura de Congo

Estoque atual: 7
```

Mensagem privada para o patrão:

```text
🔔 Nova venda

Movimentação: #V-000153
João vendeu 5 pneus
175/70 R14 SpeedMax

Total: R$1.600,00
Obs: Prefeitura de Congo
Estoque atual: 7
```

---

## 8. Menu de Estoque

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
```

O usuário pode digitar o número ou o comando direto:

```text
baixo
mais vendidos
entrada
ajuste
```

---

## 9. Entrada de Estoque

Comando:

```text
entrada
```

Fluxo:

1. Bot pergunta a medida.
2. Bot pergunta a marca.
3. Bot pergunta a quantidade.
4. Bot pergunta fornecedor.
5. Bot mostra confirmação.
6. Após confirmar, atualiza estoque.

Confirmação:

```text
⚠️ Confirmar entrada?

Produto: 175/70 R14
Marca: SpeedMax
Quantidade: +20
Fornecedor: ABC Pneus

Digite: confirmar ou cancelar
```

Após confirmar:

```text
📦 Entrada registrada

Movimentação: #E-000154
Produto: 175/70 R14
Marca: SpeedMax
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
175/70 R14 SpeedMax

Fornecedor: ABC Pneus
Estoque atual: 27
```

---

## 10. Ajuste de Estoque

Comando:

```text
ajuste
```

Permissão:

- Apenas gerente ou admin.

Fluxo:

1. Bot pergunta medida.
2. Bot pergunta marca.
3. Bot pergunta novo estoque.
4. Bot pergunta motivo.
5. Bot confirma.
6. Bot atualiza estoque.

Confirmação:

```text
⚠️ Confirmar ajuste?

Produto: 175/70 R14
Marca: SpeedMax
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
Marca: SpeedMax
Anterior: 12
Atual: 10
Responsável: João
Motivo: Conferência semanal
```

Patrão recebe no privado.

---

## 11. Baixo Estoque

Comando:

```text
baixo
```

Resposta:

```text
⚠️ Produtos abaixo do mínimo

175/70 R14 SpeedMax
Estoque: 3
Mínimo: 5

205/55 R16 Pirelli
Estoque: 2
Mínimo: 5
```

---

## 12. Mais Vendidos

Comando:

```text
mais vendidos
```

Resposta:

```text
🏆 Mais vendidos

1º 175/70 R14 SpeedMax
132 unidades

2º 205/55 R16 Pirelli
95 unidades

3º 185/65 R15 Goodyear
81 unidades
```

---

## 13. Relatório Diário

Comando:

```text
relatorio hoje
```

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
175/70 R14 SpeedMax

Produtos em baixo estoque:
3
```

---

## 14. Regras Anti-Bug

### 14.1 Consulta não trava o bot

A consulta apenas mostra dados. Ela não deixa o bot esperando resposta obrigatória.

### 14.2 Última consulta expira

A última consulta fica salva por 5 minutos. Depois disso, `venda 1 5` deve retornar:

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

Cada venda, entrada ou ajuste deve gerar um código:

- Venda: `#V-000001`
- Entrada: `#E-000001`
- Ajuste: `#A-000001`

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
- size
- brand
- stock
- minStock
- cashPrice
- creditPrice
- isActive
- createdAt
- updatedAt

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

  services/
    productService.ts
    saleService.ts
    entryService.ts
    adjustmentService.ts
    notificationService.ts
    sessionService.ts
    reportService.ts

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

### Fase 4 — Banco

1. Configurar Prisma + SQLite.
2. Criar tabelas.
3. Inserir pneus iniciais.
4. Trocar dados fake por banco.

### Fase 5 — Venda real

1. Registrar venda no banco.
2. Baixar estoque.
3. Registrar movimentação.
4. Enviar notificação privada para patrão.

### Fase 6 — Entrada

1. Implementar comando `entrada`.
2. Registrar entrada no banco.
3. Notificar patrão.

### Fase 7 — Ajuste

1. Implementar comando `ajuste`.
2. Validar permissão.
3. Registrar motivo.
4. Notificar patrão.

### Fase 8 — Relatórios

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
2. O bot mostrar marcas, estoque e preços.
3. O vendedor registrar uma venda.
4. O estoque baixar automaticamente.
5. A venda aparecer no grupo.
6. O patrão receber no privado.
7. Entrada de estoque funcionar.
8. Ajuste de estoque funcionar apenas para gerente/admin.
9. Baixo estoque e relatório diário funcionarem.
10. O sistema não ficar preso em consultas.
