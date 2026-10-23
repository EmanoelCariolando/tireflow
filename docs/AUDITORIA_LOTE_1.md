# Lote 1 — isolamento dos testes e concorrência das conversas

Data: 2026-10-22. Branch: `melhorias/auditoria-tecnica`.
Base: `7da461e8c95af131d3784688cec19caba71039f4`.
A árvore estava limpa antes da criação da branch. Não foram feitos commits,
instalações, atualizações de dependências, push, deploy ou operações reais do WhatsApp.

## Escopo e decisões

- **A10 (P2):** execução segura dos testes, antes de reproduzir A1.
- **A1 (P1):** impedir que uma mensagem concorrente cancele, expire ou substitua
  a sessão enquanto o handler anterior ainda pode gravar ou limpar seu estado.
- Decisão: reutilizar o coordenador e proteger o dispatch autorizado inteiro por
  usuário e conversa. Mensagens sobrepostas recebem uma orientação para aguardar
  e reenviar; não ficam em fila. Isso protege também os awaits de preparação e
  notificação, sem alterar transações, preços ou regras de estoque.
- Decisão: manter a proteção até o `finally`, independentemente do TTL da sessão.
  Liberá-la por tempo poderia permitir que a operação anterior ainda gravasse.
- Dependência entre tarefas: A1 usa a configuração, fontes, uploads e SQLite
  temporários fornecidos por A10. O isolamento foi validado primeiro e revisado
  novamente ao final.

## A10: antes e depois

Antes, `tsx --test` importava a aplicação a partir da instalação, permitindo
carregar sua configuração e usar caminhos operacionais de uploads e backups.
Agora, `npm test` seleciona fontes e fixtures públicas por uma lista explícita,
executa em `mkdtemp`, fornece configuração própria e remove a cópia ao terminar.
Não copia `.env`, bancos, uploads ou sessões da instalação. O único arquivo de
ambiente copiado é o modelo público `.env.example` usado pelo teste de backup.

O runner descarta as variáveis de configuração herdadas, fornece SQLite e
autenticação fictícios e usa um preloader para bloquear fetch, sockets TCP,
HTTP/HTTPS e os métodos reais de inicialização, envio e recebimento de mídia do
WhatsApp. `NODE_OPTIONS` propaga o bloqueio aos subprocessos Node com ambiente
herdado. Os clientes Prisma gerado e de runtime são copiados localmente; as
demais dependências instaladas são reutilizadas por links.

A revisão independente encontrou uma falha na primeira versão: a junction do
`node_modules` inteiro permitia ao Prisma procurar o `.env` real por
`schemaEnvPath: '../../../.env'`, mesmo em modo de testes. Assim, **não é possível
atestar ausência dessa leitura indireta nas execuções intermediárias anteriores
à revisão**. Nenhum conteúdo do `.env` foi inspecionado ou impresso por nós.
O caminho foi reproduzido com um `.env` fictício externo e corrigido com as cópias
locais do Prisma. O teste agora instancia o cliente, além de importar `env.ts`.

## A1: evidência e correção

O teste iniciou uma confirmação de venda e pausou o contato antes da gravação.
Antes da correção, outra mensagem `cancelar` recebia `Operação cancelada`, mas a
primeira execução continuava e registrava a venda. O defeito foi observado para
Dinheiro, Nota e Misto, somente em SQLite temporário.

`runOperationMessage` adquire a chave `[chatId, userId]` antes do primeiro await.
O roteador consulta essa proteção antes de qualquer expiração, cancelamento ou
navegação. A liberação em `finally` ocorre após persistência, notificações e
limpeza, inclusive quando o handler lança erro. Deduplicação e autorização
continuam antes do dispatch; o comando de identificação de grupo permanece
independente e não altera sessões operacionais.

Os testes verificam exatamente uma movimentação por venda, saldo de 3 para 2,
valores e divisão do pagamento misto preservados, rejeição de confirmação
duplicada, `cancelar`, `0`, menu e nova consulta durante processamento. Também
cobrem a fase posterior ao commit com resposta pausada, foto em download durante
expiração do TTL, cancelamento antes da confirmação, recuperação após falha e
independência entre usuários e conversas.

## Revisão de segurança e simplicidade

Revisão Ponytail com contexto independente e análise diferencial Trail of Bits.
Foram examinados todos os arquivos de implementação e testes do lote, o histórico
das regiões alteradas, o runtime gerado do Prisma, o chamador em `src/index.ts`,
configuração de caminhos e os fluxos de cancelamento e gravação.

O ponto de entrada de produção tem um chamador, em `src/index.ts:73`; o novo
coordenador tem um chamador de produção, no roteador. O alcance indireto inclui
todos os comandos autorizados. Não se removeu autorização, validação de negócio,
log existente ou teste. Não há nova dependência nem mudança de schema.

Cenários examinados: mensagens concorrentes de membro autorizado; navegação que
limpa sessão durante uma gravação; expiração durante await; limpeza tardia de
handler antigo; leitura indireta de dotenv pelo Prisma; configuração de produção
herdada e subprocesso sem bloqueio offline. As duas lacunas de isolamento
encontradas na revisão foram reproduzidas com fixtures fictícias e corrigidas.
Após os ajustes, a revisão independente não encontrou outro defeito concreto.

## Validação

- RED A10: o teste de configuração carregou a sentinela fictícia antes do guard.
- RED da revisão A10: o cliente Prisma carregou a sentinela externa e o
  subprocesso não tinha o bloqueio offline; ambos falharam antes das correções.
- GREEN A10: ambos os testes de isolamento passaram após as correções.
- RED A1: três formas de pagamento retornaram cancelamento indevido durante venda.
- GREEN A1: 7 testes, incluindo o agrupador, passaram em SQLite temporário.
- Suíte completa final: `npm test`, 266 testes aprovados, zero falhas, cancelados
  ou ignorados; saída 0, duração de 57,5 segundos no Node.js v24.17.0/Windows.
- `node --check scripts/run-tests.cjs` e `node --check tests/offline.cjs`: passaram.
- `npm run typecheck` e `npm run build`: ambos passaram, saída 0.
- `git diff --check`: passou; Git apenas informou a conversão habitual LF/CRLF.
- Lint: não há script/configuração de lint no projeto; nenhuma ferramenta adicionada.

Migrações existentes foram aplicadas somente a SQLite descartável dos testes.
Nenhum banco de produção foi alvo de migração ou mutação intencional.

A primeira execução completa após propagar o preloader falhou porque o guard de
socket lançava erro síncrono, incompatível com o IPC opcional do tsx. A correção
mantém a conexão bloqueada e devolve erro assíncrono como a API `net`; os quatro
testes focados de isolamento/sincronização passaram antes da suíte final verde.

## Limites e pendências

- O runner fornece isolamento para a suíte atual; não é uma sandbox contra código
  malicioso que leia caminhos absolutos, remova os guards ou altere dependências.
  Rodar testes diretamente contorna essa proteção. Use `npm test`.
- A exclusão entre mensagens vale por processo, como os stores existentes e a
  implantação documentada. Não constitui coordenação entre múltiplas instâncias.
- Uma Promise que nunca termina mantém aquele usuário e conversa ocupados. Não
  foi acrescentado timeout que libere uma gravação ainda em andamento.
- Mensagens sobrepostas precisam ser reenviadas. Cancelamento é aceito entre
  etapas, não durante execução de um handler, inclusive preparação de mídia.
- Testes com serviços reais e validação operacional de WhatsApp não foram feitos.
- Os demais achados da auditoria continuam abertos. Lote 2 não foi iniciado e
  depende de aprovação própria. Este relatório valida somente A10 e A1.
