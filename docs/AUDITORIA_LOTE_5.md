# Lote 5 — A4 + A11: integridade e retenção de backups

Data: 2026-10-23. Branch: `melhorias/auditoria-tecnica`.

## Preservação

Foram revisados os 12 arquivos do Lote 4, sem alterações inesperadas, banco,
uploads, backups verdadeiros, credenciais ou sessão no diff. Nova verificação:
494 testes aprovados, zero falhas; tipos e build aprovados. Commit local
`70a6930`: `Validate backup restoration and preserve recoverable previous state (Lote 4)`.
A árvore ficou limpa antes de começar o Lote 5. Não houve push, merge ou deploy.

## Reavaliação antes de corrigir

| Achado / cenário | Estado no início deste lote | Evidência concreta |
| --- | --- | --- |
| A4: sucesso com banco/fotos referenciadas quebradas | Resolvido pelo Lote 4 | `createBackupWithLock` valida SQLite e fotos antes do manifesto e da retenção; teste existente de referência ausente preserva o backup anterior |
| A4: troca/exclusão de foto entre snapshot e cópia | Parcialmente resolvido: integridade protegida, disponibilidade não garantida | Teste chama `replaceProductPhoto` depois do snapshot e antes do cp: novo UUID é salvo, referência atualizada e foto anterior removida; backup falha sem manifesto nem poda |
| A4: troca de foto depois da cópia | Resolvido para o fluxo normal | Novo teste demonstra que o backup guarda a referência e os bytes da foto antiga, continua restaurável após a troca na origem e independe da referência operacional nova |
| A4: sobrescrita silenciosa dos bytes da foto pelo aplicativo | Não comprovado | `saveProductImageFile` grava arquivo com UUID e flag `wx`; a troca usa outro caminho, sem sobrescrever o anterior |
| A4: dois backups do mesmo banco; backup × restore | Resolvido pelo Lote 4 | Participações existentes; testes do Lote 4 e novo caso com dois processos reais demonstram recusa do concorrente |
| A4: falha na escrita/publicação do manifesto | Integridade já protegida; cobertura de interrupção ampliada | Erro de escrita deixa anteriores restauráveis; manifesto truncado por término abrupto é rejeitado pelo restore |
| A11: falha na poda apaga backup novo publicado | Ainda reproduzível no baseline, P1 | EACCES/ENOSPC na exclusão de expirado fazia o catch de criação remover também a cópia nova; testes falharam antes da correção |
| A11: outra filial ou pasta apenas nomeada como data é removida | Ainda reproduzível no baseline, P1 | Retenção selecionava só pelo nome; testes perderam manifesto estrangeiro e arquivo de pasta não reconhecida |
| A11: relógio retrocede e o backup recém-criado é excluído | Ainda reproduzível no baseline, P1 | Criar dia 19 depois de existir dia 20 com retenção 1 retornava caminho inexistente; isto também afeta quem confia em `createBackup` antes de alterar estoque |
| A11: cópia corrompida conta no lugar de antiga válida | Ainda reproduzível no baseline, P1 | Novo válido + antigo recente corrompido com manifesto + antigo válido, retenção 2: o válido antigo era apagado |
| A11: diretório inesperado sob nome de arquivo permitido | Ainda reproduzível após a primeira seleção positiva, P2 | Um `.env.example` que era diretório com outros dados passava no validador e era apagado; teste reproduziu a perda |

O RED inicial teve seis casos de A11 falhando, além do agrupador. Os três casos
de foto/publicação passaram sem mudança de produção para A4. Não foi criada fila
global, bloqueio novo, novo formato de backup ou mecanismo paralelo de publicação.

## Correções efetivamente necessárias

Em `src/database/backup.ts:41`, a retenção continua olhando somente subdiretórios
diretos com o padrão de data existente, mas agora:

1. Reserva o backup recém-publicado como a primeira cópia mantida, independentemente
   da ordenação de datas. Mantém no máximo outros `retention - 1` candidatos válidos.
2. Reutiliza `inspectBackup` para comprovar estrutura e filial exata. Pastas não
   reconhecidas, incompletas, incompatíveis ou de outra filial são preservadas e
   não entram na contagem; a decisão é informada por aviso no log.
3. Copia somente o SQLite candidato para um diretório temporário e reutiliza
   `validateStagedDatabase` com os uploads arquivados. O original não é aberto
   pelo Prisma nem normalizado para outro journal. Isso impede que um banco
   corrompido ou incompatível elimine um válido da contagem.
4. Confere caminho direto e links antes da exclusão. A raiz temporária precisa
   continuar sendo filha direta do diretório temporário do SO para ser removida.
5. Exclui somente candidatos verificados que excedam a retenção. Um erro de
   exclusão interrompe a poda; não continua removendo outras cópias após a falha.

Em `src/database/backup.ts:129`, a retenção ficou fora do catch que limpa uma
criação incompleta. Se a poda falhar, a função lança erro com o caminho da cópia
válida preservada e a causa original. O CLI/agendamento mantém saída de erro,
sem declarar que a retenção terminou com sucesso e sem apagar a cópia nova.

Em `src/database/backupValidation.ts:87`, cada entrada de raiz precisa ter o
tipo esperado: uploads é diretório; banco, manifesto e `.env.example`, quando
presente, são arquivos regulares. É a mesma validação usada pelo restore.

## Garantias demonstradas

- Novo backup publicado permanece restaurável quando expiração falha por
  EACCES/ENOSPC ou após exclusão parcial de um expirado.
- Cópias ainda pertencentes ao conjunto retido continuam restauráveis.
- Backup de outra filial não é removido, e foi restaurado em teste com a filial
  correspondente. Pastas desconhecidas e estruturas inesperadas ficam intactas.
- Banco corrompido não conta como cópia retida e não provoca exclusão do válido.
- Atraso do relógio não apaga o backup recém-criado nem retorna caminho inexistente.
- Troca normal da foto pode produzir recusa segura; se a foto anterior já foi
  copiada, referência e bytes arquivados permanecem consistentes.
- Interrupções de processo após snapshot, durante manifesto, após publicação e
  durante poda não destroem as cópias novas e retidas já publicadas.
- Após usar o recovery de lock órfão já existente no Lote 4, outro backup pode ser
  executado; manifesto ausente/truncado não é contado nem aceito para restauração.

## Testes

Novos arquivos: `tests/backupIntegrity.test.ts` e `tests/backupCrashWorker.ts`.
O primeiro usa SQLite próprio descartável e restaura de fato as cópias em destinos
temporários. O segundo simula término de processos com saída 91, sem finally.

Casos: erro de retenção EACCES/ENOSPC, exclusão parcial, relógio atrasado,
outra filial, pasta sem manifesto, candidato corrompido, diretório disfarçado de
arquivo, troca de foto antes/depois do cp, erro ao publicar manifesto, dois
processos concorrentes e reinício após quatro pontos críticos.

Uma execução combinada detectou que o novo teste usava inicialmente o banco
padrão do runner em comum com `backup.test.ts`. A fixture foi corrigida para
criar seu próprio banco antes de importar a aplicação e passar esse caminho aos
filhos. Não foi alterada a arquitetura do runner nem qualquer dado operacional.
As imagens têm nomes exclusivos e ficam somente na cópia temporária do projeto.
O worker verifica o ambiente temporário antes de importar módulos da aplicação.

Resultados finais, após a última alteração de código:

| Verificação | Resultado real |
| --- | --- |
| Suíte completa isolada (`npm test`) | 510 aprovados, zero falhas, cancelamentos ou skips; 81,42 s; saída 0 |
| Testes relacionados: integridade, backup, restore e scripts agendados | 81 aprovados, zero falhas, cancelamentos ou skips; 40,34 s; saída 0 |
| Ampliação sobre o baseline de 494 | 16 testes contabilizados, incluindo o agrupador |
| `npm run typecheck` | Aprovado, saída 0 |
| `npm run build` | Aprovado, saída 0 |
| TypeScript dos dois novos arquivos de testes | Aprovado, saída 0 |
| `git diff --check` | Aprovado |

Não existe script de lint neste projeto; nenhuma ferramenta foi instalada.

## Revisão e segurança

Reavaliação e revisão independente Ponytail aprovaram a alteração, sem achados
P1/P2 restantes no diff revisado; os checks finais também passaram. A análise seguiu
os critérios Trail of Bits para caminhos de exclusão, limites de confiança,
concorrência, preservação de dados e testes de falhas.

Os chamadores `clearLocationStock` e `restoreLocationStock` mantêm sua interface:
um erro continua abortando o chamador; sucesso retorna caminho do backup existente.
O manifesto v1 e a CLI de restauração não foram alterados. O validador do Lote 4
foi reutilizado; a cópia temporária evita modificar backups antigos para validá-los.
Nenhuma dependência foi instalada ou atualizada.

Referência consultada via Context7: [Node.js 24 — fs.rm e diretórios temporários](https://nodejs.org/docs/latest-v24.x/api/fs.html).
Não há promessa de exclusão recursiva atômica nem de rollback de arquivos expirados
já removidos; a segurança vem da seleção conservadora e preservação do conjunto válido.

## Compatibilidade e procedimentos

- Backups v1 completos e compatíveis continuam aceitos pelo restore do Lote 4.
- Backups de schema antigo/futuro ou outras filiais não são apagados pela retenção
  desta instalação e não contam para seu limite de cópias verificáveis.
- Retenção 7 significa: cópia recém-validada e até seis outras verificáveis da
  mesma filial, por nome de data decrescente. Não é um limite de todas as pastas
  que possam existir no BACKUP_ROOT.
- Um aviso de candidato preservado exige avaliar manualmente a pasta se for
  necessário liberar espaço. Não force a exclusão apenas porque o nome parece data.
- Falha de retenção gera erro no CLI/agendamento com caminho da cópia nova
  preservada. Corrija a causa e confira essa cópia; não a descarte por causa da
  saída de erro. A exclusão interrompida pode deixar resíduo parcial do expirado.
- Recuperação de lock após interrupção segue `restore --recover --confirm` e o
  procedimento já aprovado no Lote 4, com serviço e tarefas da filial parados.
  Não foi adicionada recuperação automática de lock órfão de backup.

## Limitações restantes

- Backup ao vivo não é um snapshot global atômico entre banco e fotos. Se a foto
  necessária desaparecer antes do cp, ele falha e preserva os anteriores. Garantir
  sucesso nessa corrida exigiria outra política; não foi necessário para integridade.
- Exclusão entre processos continua sendo por banco, não por BACKUP_ROOT global.
  Mantenha os diretórios separados por filial, conforme o procedimento existente.
  Instalações distintas da mesma filial compartilhando a mesma raiz não têm
  exclusão global de poda; não se declara suporte seguro a essa configuração.
- A resolução dos nomes continua sendo de segundos. Colisão de pasta recusa a
  criação sem sobrescrever a existente. Não foi alterado o formato histórico.
- Os arquivos arquivados e suas raízes devem ser protegidos contra escrita externa.
  Não se garante segurança contra um agente local que modifique os arquivos entre
  validação e exclusão, nem contra alteração de backup publicado fora do aplicativo.
- Manifesto identifica a filial por configuração; não é assinatura de procedência.
- Validar os candidatos adiciona leitura/cópia do banco e verificação das fotos.
  Custo acompanha o volume arquivado; não há nova fila ou pausa global das vendas.
- Candidatos não verificáveis permanecem sem prazo automático. É possível ficar
  acima da retenção em número total de pastas; isso é preservação conservadora.
- Uma queda de processo durante validação pode deixar cópia temporária órfã no
  TEMP do SO. Ela não é publicada nem contada; nenhum backup é removido para limpá-la.
- Falhas de energia/disco e ACLs reais não foram simuladas. Permissões e ENOSPC
  foram injetados; perdas físicas dependem também de cópia externa e infraestrutura.
- As fotos de testes têm UUIDs distintos, mas compartilham a raiz de uploads da
  cópia temporária do runner. Não houve falha após isolar o banco; eventual ENOENT
  intermitente deve ser investigado como possível interferência entre fixtures,
  não como vulnerabilidade de produção comprovada.
- Banco, uploads e backups operacionais, credenciais e WhatsApp real não foram
  acessados ou utilizados. Não houve migração destrutiva ou operação operacional.

## Arquivos e Git

Modificados: `src/database/backup.ts`, `src/database/backupValidation.ts` e
`docs/DAILY_BACKUPS.md`. Novos: os dois arquivos de testes e este relatório.
HEAD `70a6930`; branch `melhorias/auditoria-tecnica`. Lote 5 sem commit, índice
vazio. Sem push, merge, deploy ou avanço para o Lote 6.

## Próximo lote recomendado

Confrontar os achados ainda abertos com o planejamento original e priorizar os
próximos P1. O relatório integral original não está versionado neste repositório;
não foram inventados novos identificadores ou uma ordem para A6–A9.
Como candidato já documentado, permanece a recuperação de devolução de pendência
quando o produto foi reabastecido até Int32 (Lote 3): a operação faz rollback e
a pendência continua aberta. Revalidar esse caso antes de definir correção seria
um escopo concreto; nenhuma implementação ou nova auditoria desse fluxo foi iniciada.
