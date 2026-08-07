# TireFlow

> Controle de estoque e vendas de pneus diretamente pelo WhatsApp.

O **TireFlow** transforma o WhatsApp em uma interface simples para consultar produtos, registrar vendas e manter o estoque atualizado em tempo real.

## Funcionalidades

- Consulta de pneus por medida
- Vendas com múltiplos produtos
- Pagamento à vista, a prazo ou misto
- Entrada e ajuste de estoque
- Cadastro de produtos e preços
- Fotos e localização física dos pneus
- Relatórios de vendas e baixo estoque
- Notificações privadas ao responsável
- Backup do banco de dados e das imagens

## Exemplo de uso

Consulte uma medida:

```text
pneu 175/70 R14
```

O bot retorna os produtos disponíveis. Para vender duas unidades da primeira opção:

```text
venda 1 2
```

Depois, basta seguir as instruções enviadas pelo próprio bot para escolher o pagamento e confirmar a operação.

## Principais comandos

| Comando | Ação |
| --- | --- |
| `pneu <medida>` | Consultar pneus |
| `venda <item> <quantidade>` | Registrar uma venda |
| `entrada <item>` | Adicionar estoque |
| `ajuste <item>` | Corrigir o estoque |
| `preco <item>` | Atualizar preços |
| `foto <item>` | Visualizar uma foto |
| `addfoto <item>` | Cadastrar uma foto |
| `local <item>` | Atualizar a localização física |
| `cadastrar pneu` | Cadastrar um novo produto |
| `menu` | Abrir o menu de relatórios |
| `status` | Verificar o estado do sistema |

> Os comandos que utilizam um item devem ser executados depois de uma consulta.

## Tecnologias

- Node.js
- TypeScript
- WhatsApp Web.js
- Prisma ORM
- SQLite

## Como executar

### Pré-requisitos

- Node.js LTS
- Google Chrome
- Uma conta do WhatsApp

### Instalação

```bash
git clone https://github.com/EmanoelCariolando/tireflow.git
cd tireflow
npm install
```

Crie o arquivo de configuração:

```powershell
Copy-Item .env.example .env
```

Preencha o `.env` usando o arquivo [`.env.example`](.env.example) como referência. Depois, prepare o banco:

```bash
npx prisma generate
npx prisma migrate deploy
```

Inicie o projeto:

```bash
npm run dev
```

Na primeira execução, leia o QR Code exibido no terminal para conectar o WhatsApp.

## Scripts

```bash
npm run dev        # desenvolvimento
npm run build      # compilar o projeto
npm start          # executar a versão compilada
npm test           # executar os testes
npm run check      # validar tipos, testes, build e Prisma
npm run backup     # criar um backup
```

## Estrutura

```text
src/
├── commands/       # comandos do WhatsApp
├── config/         # configurações
├── database/       # banco, seed e backups
├── repositories/   # acesso aos dados
├── services/       # regras de negócio
├── utils/          # funções auxiliares
└── whatsapp/       # cliente e mensagens

prisma/             # schema e migrations
tests/              # testes automatizados
docs/               # documentação de produção
```

## Documentação

Para implantação, serviço Windows e backups automáticos, consulte a pasta [`docs`](docs).

## Autor

Desenvolvido por **Emanoel Messias**.

## Licença

Projeto privado. Todos os direitos reservados.
