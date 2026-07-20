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

## 📷 Fotos de produtos

Após consultar uma medida, qualquer usuário autorizado pode visualizar a foto cadastrada:

```text
foto 1
```

Qualquer usuário autorizado no grupo pode adicionar ou substituir a imagem:

```text
addfoto 1
```

As imagens são mantidas localmente em `uploads/products/` e o banco armazena apenas o caminho relativo.

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
NODE_ENV=production
DATABASE_URL="file:./tireflow.db"
WHATSAPP_OFFICIAL_GROUP_ID=
BOSS_PRIVATE_NUMBER=
OWNER_PHONE=
DAILY_REPORT_TIME=18:00
ALLOW_PRIVATE_TEST_MODE=false
BRANCH_NAME="ATC PNEUS CONGO"
```

`ALLOW_PRIVATE_TEST_MODE` pode ser `true` ou `false` em produção. Com `true`, os comandos também podem ser testados em conversa privada.

O guia completo para Congo e Monteiro está em [docs/PRODUCTION.md](docs/PRODUCTION.md),
com a instalação do serviço do Windows em [docs/NSSM.md](docs/NSSM.md).

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

## Foto do produto

```text
foto 1
```

## Adicionar ou substituir foto

```text
addfoto 1
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

## Estado do sistema

```text
status
```

Verifica WhatsApp, banco, uploads, filial, tempo ativo e versão sem expor segredos.

## Backup

```text
npm run backup
```

---

# 📈 Roadmap

## MVP ✅

- Consulta de pneus
- Venda
- Entrada
- Ajuste
- Alteração de preços
- Fotos de produtos
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
