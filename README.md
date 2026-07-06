# 🚗 TireFlow

> Sistema inteligente de controle de estoque de pneus via WhatsApp.

O **TireFlow** é um sistema desenvolvido para facilitar o gerenciamento de estoques de lojas e atacados de pneus utilizando o próprio WhatsApp como interface.

O objetivo é eliminar planilhas, reduzir erros operacionais e permitir que toda movimentação de estoque seja registrada em tempo real de forma simples e rápida.

---

# ✨ Funcionalidades

## 🔍 Consulta de produtos

Pesquisar pneus pela medida.

Exemplo:

```text
pneu 175/70/14
```

---

## 🛒 Registro de vendas

Após a consulta:

```text
venda 1 2
```

O sistema:

- seleciona o produto pesquisado;
- solicita forma de pagamento;
- recebe comprovante quando necessário;
- confirma a venda;
- baixa automaticamente o estoque;
- registra a movimentação;
- envia notificação privada ao proprietário.

---

## 📦 Entrada de estoque

```text
entrada 2
```

Permite adicionar novos produtos ao estoque.

---

## ⚖️ Ajuste de estoque

```text
ajuste 1
```

Permite corrigir divergências de estoque.

---

## 💲 Alteração de preços

```text
preco 3
```

Atualiza:

- preço à vista;
- preço a prazo.

Todas as alterações ficam registradas.

---

## 📊 Relatórios

Disponíveis:

- Relatório do dia
- Produtos com baixo estoque
- Produtos mais vendidos

Também possui envio automático diário ao proprietário.

---

# 📱 Fluxo de venda

```text
Consulta

↓

Venda

↓

Pagamento

↓

Comprovante (quando necessário)

↓

Confirmação

↓

Atualização do estoque

↓

Notificação no grupo

↓

Notificação privada ao proprietário
```

---

# 🔐 Segurança

- Apenas grupo autorizado pode utilizar o sistema.
- Administradores possuem comandos administrativos.
- Operações possuem timeout.
- Confirmação obrigatória.
- Registro de responsável.
- Registro de data e hora.
- Histórico completo das movimentações.

---

# 💻 Tecnologias

- Node.js
- TypeScript
- WhatsApp Web.js
- Prisma ORM
- SQLite
- QRCode Terminal
- dotenv

---

# 📁 Estrutura

```text
src/
├── commands/
├── database/
├── repositories/
├── services/
├── whatsapp/
├── utils/

prisma/

data/
└── seed/
```

---

# 🚀 Instalação

```bash
npm install
```

---

Criar o arquivo:

```env
.env
```

Exemplo:

```env
AUTHORIZED_GROUP_ID=

OWNER_PHONE=

ALLOW_PRIVATE_TEST=true

REPORT_TIME=20:00
```

---

Executar:

```bash
npm run dev
```

---

Importar produtos:

```bash
npm run seed:products
```

---

# 📋 Comandos

## Consulta

```text
pneu 175/70/14
```

---

## Venda

```text
venda 1 2
```

---

## Entrada

```text
entrada 1
```

---

## Ajuste

```text
ajuste 1
```

---

## Alteração de preço

```text
preco 1
```

---

## Menu

```text
menu
```

Opções:

```text
1 Relatório de hoje

2 Baixo estoque

3 Mais vendidos
```

---

# 📈 Roadmap

## MVP ✅

- Consulta de pneus
- Venda
- Entrada
- Ajuste
- Alteração de preços
- Relatórios
- Controle de estoque
- Banco de dados
- Notificações privadas
- Controle por grupo do WhatsApp

---

## Futuro

- QR Code PIX automático
- Dashboard Web
- Multiempresa
- Backup automático
- Histórico avançado
- Integração com ERP

---

# 👨‍💻 Autor

**Emanoel Messias**

Projeto desenvolvido como solução para automação de estoque e vendas em atacados de pneus, utilizando o WhatsApp como interface principal.

---

# 📄 Licença

Projeto privado.
Todos os direitos reservados.
