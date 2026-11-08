# TireFlow Control — plano e decisões

Pedido: painel administrativo independente, exclusivamente em `127.0.0.1`, sem
alterar as regras comerciais ou executar operações operacionais no desenvolvimento.

## Estrutura escolhida

Node HTTP, TypeScript e HTML/CSS/JS sem novas dependências. O painel tem entrada
própria em `src/control/index.ts`; o bot continua em `src/index.ts`. NSSM permanece
o único supervisor. Não usar hospedagem externa nem Electron.

Configuração administrativa em `control.config.json`, ignorada pelo Git. Nome do
serviço, caminho NSSM e branch pertencem exclusivamente a essa configuração local.
Ausência de configuração e falhas de permissão são estados indisponíveis.

## Etapas internas

- [ ] Status, heartbeat sem dados comerciais, leitura incremental de logs, proteção
  Host/Origin/CSRF e interface responsiva. Testar entradas maliciosas, heartbeat
  vencido, rotação/truncamento e ausência do bot.
- [ ] Adaptador NSSM com ações fixas, validação da instalação e permissões,
  exclusão mútua, confirmação e conferência do estado final. Backup pelo mecanismo
  existente em processo separado; não importar o cliente WhatsApp no painel.
  Testar concorrência, falhas e resultados reais com adaptadores isolados.
- [ ] Verificação manual de branch GitHub e indicação das versões por commit.
  Aplicação e recuperação de atualização aguardam confirmação da branch de
  produção e da estratégia para migrations, solicitadas ao usuário. Não presumir
  que `master` seja a branch operacional. Não criar um atualizador especulativo.
- [ ] Typecheck, build, suíte isolada completa, revisão, commits apenas locais e
  documentação de instalação NSSM independente e atalho Windows.

## Segurança e verificação

Bind fixo em IPv4 loopback; Host exato com porta; Origin exata nas mutações;
token aleatório por processo; lista fechada de ações e limite de corpo. Nenhum
parâmetro de comando ou caminho vem do navegador. Erros administrativos públicos
não incluem stdout/stderr, credenciais ou arquivos de configuração.

Logs: leitura limitada por arquivo, offsets privados do servidor e anel limitado;
apresentar somente eventos estruturados, ocultando conteúdo livre/confidencial.
Heartbeat contém somente PID, instante, uptime e boolean de conexão WhatsApp;
expiração e correspondência com o processo impedem anunciar conexões antigas.

Não testar por parada/reinício/backup/atualização do ambiente operacional.
O runner existente copia somente fontes e fixtures públicas para pasta temporária.
Testes do protocolo HTTP usam Request/Response em memória, sem rede externa.

## Inspeção inicial

Base `06b6565`, árvore limpa, branch de trabalho `feat/local-control-panel`.
Serviço instalado não confirmado: consulta CIM negada pelo ambiente. Os scripts
existentes instalam serviços separados por filial e fazem backup ao vivo com
validação SQLite/fotos e bloqueios de manutenção. Não há atualizador automático.
Documentos operacionais incluem migrations e preservação de `.env`, banco,
sessão, uploads e dados. A referência visual mencionada não veio anexada; seguir
a composição e paleta descritas no pedido.
