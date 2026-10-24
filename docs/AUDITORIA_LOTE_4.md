# Lote 4 — A3: restauração segura e recuperável

Data: 2026-10-23. Branch: `melhorias/auditoria-tecnica`.

## Preservação do Lote 3

O diff completo continha exclusivamente os 21 arquivos previstos de A5, sem
credenciais, sessão, banco, uploads ou alterações inesperadas. A suíte isolada
foi repetida: 435 aprovados, zero falhas; typecheck e build aprovados. Commit
local `53c379c`: `Unify numeric validation and preserve financial precision (Lote 3)`.
A árvore ficou limpa antes de iniciar A3. Não houve push, merge ou deploy.

## Causa comprovada e escopo

O fluxo anterior validava apenas três campos do manifesto e a existência do
banco e dos uploads. Em seguida copiava por cima do banco atual, removia os
uploads e copiava os novos. Banco corrompido, filial errada ou fotos ausentes não
eram recusados. Uma falha na segunda cópia podia deixar banco substituído e
uploads removidos, sem cópia anterior recuperável. Não havia coordenação com
o processo do aplicativo, nem tratamento de WAL/SHM ou interrupção entre recursos.

Prioridade A3: P1, com impacto potencial de perda de estoque, vendas, usuários,
preços e fotos durante uma operação administrativa. Os testes reproduziram a
aceitação incorreta antes da correção, usando somente fixtures descartáveis.

O Lote 4 trata a restauração integral. `restore:location-stock` é uma operação
de negócio diferente e não foi reescrita; ela e outros scripts devem permanecer
parados durante a janela de manutenção.

## Decisões aprovadas pelo usuário

- Recusar backups sem identificação confiável da filial, schema incompatível,
  WAL/journal ou estrutura incompleta; compatibilizar uma cópia separada.
- Parar serviço e suspender tarefas/scripts; usar bloqueio cooperativo entre
  app atualizado, restauração e backup; interromper startup quando a restauração
  estiver incompleta; recuperação explícita e nenhuma limpeza automática do anterior.

## Estratégia implementada

1. Validar caminhos dos destinos e sua separação da origem, dos sidecars e dos
   caminhos reservados. Recusar links simbólicos, junctions e hardlinks de arquivos.
2. Adquirir bloqueio de restauração antes da preparação. O app adquire seu bloqueio
   antes de `runStartupChecks`, que cria diretórios e abre o SQLite. O backup usa
   participação separada: pode coexistir com o app e impede restauração simultânea.
3. Inspecionar a origem sem abrir seu banco. Aceitar somente manifesto v1 completo,
   filial exata e arquivos previstos. Verificar contagem, assinatura e tamanho
   das imagens usando a validação já existente; recusar referências a placeholders.
4. Preparar banco e uploads em diretórios irmãos de seus respectivos destinos,
   para que cada troca use rename no mesmo volume. O SQLite só é aberto na cópia.
5. Conferir `integrity_check`, `foreign_key_check`, migrações concluídas, conjunto
   exato de migrações e checksums (compatíveis com LF/CRLF), tabelas/colunas usadas
   pelo cliente Prisma e todas as referências de fotos, incluindo produtos inativos.
   A cópia é normalizada para journal DELETE; nenhuma migração é aplicada.
6. Registrar destinos, UUID e existência anterior; solicitar sync do journal e
   do marcador `prepared` antes de iniciar as trocas.
7. Mover banco e sidecars anteriores para preservação; mover uploads anteriores;
   instalar os dois recursos preparados; registrar `committed` somente ao final.
8. Em erro, remover eventual marcador de conclusão antes de começar rollback.
   Copiar de volta os anteriores preservados, mantendo essas cópias para novas
   tentativas. Registrar `rolled-back` somente após terminar a recuperação.
9. Se a recuperação também falhar, manter journal incompleto e bloquear startup.
   Após encerramento abrupto do processo, `restore --recover --confirm` recupera
   o estado anterior; não continua instalando um backup pela metade.

Isso é uma sequência recuperável, não uma transação atômica entre banco e fotos.
O novo processo não pode usar um par intermediário quando respeita o bloqueio.

## Arquivos de trabalho e recuperação

Para banco `B` e uploads `U`:

| Caminho | Conteúdo/finalidade |
| --- | --- |
| `B.tireflow-lock` | PID, token e finalidade do participante principal |
| `B.backup.tireflow-lock` | Participação exclusiva da criação de backup |
| `B.restore/state.json` | Destinos exatos, UUID e presença anterior |
| `B.restore/database.sqlite` | Banco preparado, antes de instalado |
| `B.restore/previous.sqlite*` | Banco e sidecars anteriores, quando já movidos |
| `U.restore-UUID/new` | Uploads preparados, antes de instalados |
| `U.restore-UUID/previous` | Uploads anteriores, quando já movidos |
| `B.restore/prepared`, `committed`, `rolled-back` | Marcadores de progresso/conclusão |
| `B.restore-recovery/owner.json` | Exclusão entre recuperadores e identificação do operador/processo |

A próxima restauração arquiva um journal já finalizado em
`B.restore.history-UUID`; não remove os anteriores nem seus uploads preservados.
Esses artefatos foram incluídos no `.gitignore`, pois podem conter dados comerciais.

O journal é validado mesmo quando existe marcador de conclusão. Caminhos usados
para recuperar são derivados dos destinos configurados e de UUID validado;
um JSON alterado não pode redirecionar a recuperação para outro diretório.

Somente `ESRCH` autoriza considerar o PID morto. PID vivo, reutilizado, sem
permissão de inspeção (`EPERM`) ou proprietário inválido bloqueiam a remoção.
Dois recuperadores disputam o guard antes de remover qualquer lock órfão.

Uma queda comum do app, sem restauração incompleta, permite retomada automática
do NSSM: sob o mesmo guard exclusivo, exige proprietário `app` morto, relê o
journal e cria/sincroniza o novo lock antes de soltar o guard. Locks de restauração
e de backup abandonados exigem recuperação explícita.

## Criação de backups

O comando mantém `VACUUM INTO`, os caminhos e o manifesto v1. Agora verifica
o banco e as fotos antes de publicar o manifesto e executar a retenção. Se uma
foto antiga desaparecer entre o snapshot SQLite e a cópia dos uploads, a criação
falha sem podar backups anteriores. Não se promete snapshot global atômico ao vivo.
No executável de backup, sua participação permanece até desconectar o Prisma.

## Compatibilidade histórica

| Situação | Comportamento |
| --- | --- |
| Pasta v1 completa da filial exata, schema e fotos compatíveis | Aceita |
| ZIP ou arquivo SQLite avulso, sem pasta v1 completa | Não aceito diretamente |
| Manifesto sem filial/contagem ou nomes de arquivos diferentes | Recusa antes de substituir |
| Filial diferente, inclusive nome histórico não idêntico | Recusa; sem alias automático |
| Migração faltante, futura, incompleta ou checksum divergente | Recusa; sem migração automática |
| Histórico completo com coluna exigida ausente | Recusa |
| Banco corrompido, referência quebrada ou imagem fora da estrutura | Recusa |
| WAL/SHM/journal acompanhando a origem | Recusa; não descartar esses arquivos para forçar aceitação |

Compatibilização deve ocorrer fora dos destinos operacionais, em uma cópia
completa e preservando o original. Se houver WAL/journal, use ferramenta SQLite
apropriada para gerar um snapshot consistente da cópia. Reconciliar nome de filial,
histórico e referências exige revisão do operador; não basta editar o manifesto
para contornar as verificações. Um banco íntegro não prova sua procedência.

## Testes e verificação

`tests/restoreBackup.test.ts` usa migrações existentes somente para montar bancos
descartáveis. `tests/restoreCrashWorker.ts` encerra processos filhos com saída 91
após operações críticas, sem executar finally, para simular interrupção do processo.
`tests/backup.test.ts` agora monta schema real e verifica que backup com referência
de foto ausente falha antes da retenção. Todos usam o runner isolado do Lote 1.

Cobertura: backup válido/corrompido, outra filial, banco/foto ausente, schema
histórico/futuro/incompleto/alterado, checksum, caminhos externos/sobrepostos,
junction, placeholder, EACCES/ENOSPC simulados, falhas antes/depois dos renames,
preparação, destinos originalmente ausentes, interrupção nos marcadores e em cada
troca, rollback falho, segunda interrupção durante recovery, repetição e concorrência
de recovery, PID vivo/EPERM, app ativo, backup ao vivo, startup real bloqueado e
reinício automático após crash comum do app. Um caso cria um WAL real com transação
confirmada, encerra o escritor e demonstra recuperação dos bytes e do saldo anterior.

Resultados finais (Node 24.17.0, sem instalar ou atualizar dependências):

| Verificação | Resultado real |
| --- | --- |
| Suíte completa isolada: `npm test` | 494 aprovados, zero falhas/cancelados/ignorados, saída 0; 67,8 s |
| Novos e relacionados | 68 aprovados, zero falhas, saída 0 |
| Casos adicionais sobre o Lote 3 | 59, incluindo o agrupador do novo arquivo de testes |
| `npm run typecheck` | Aprovado, saída 0 |
| `npm run build` | Aprovado, saída 0 |
| Tipos dos três arquivos de testes envolvidos | Aprovados em checagem separada |
| `git diff --check` | Aprovado; apenas avisos habituais LF/CRLF |
| Ignore dos snapshots e locks | Conferido com `git check-ignore --no-index`, sem criar artefatos |

Não há script de lint no projeto; nenhuma ferramenta foi instalada para criá-lo.

## Revisão independente e segurança

Revisão Ponytail independente e análise diferencial de perda de dados/caminhos
com os critérios Trail of Bits. Histórico e blame confirmaram que a substituição
antecipada já existia no commit `ff26f659`; o baseline deste lote é `53c379c`.
Foram rastreados os chamadores: CLI de restore, CLI de backup, inicialização,
`clearLocationStock` e `restoreLocationStock`. Os dois últimos mantêm suas regras
e participam do backup apenas durante essa etapa; devem continuar parados durante
uma restauração, conforme o procedimento aprovado.

Achados reproduzidos e encerrados antes da verificação final:

- Schema com histórico completo e coluna exigida removida: passou a ser recusado.
- Foto referenciando `.gitkeep`, inclusive `.GITKEEP` no Windows: exigência de
  extensão de imagem válida fecha o bypass; variantes foram testadas.
- Uploads ocupando caminho reservado de WAL: caminhos reservados agora são
  considerados na separação dos destinos.
- Falha de sync do marcador seguida de falha no rollback: o marcador de conclusão
  é removido antes da tentativa de recuperação, mantendo startup bloqueado se falhar.
- Lock órfão de uma queda comum do aplicativo: retomada segura sem perder o reinício
  automático do NSSM; locks de restauração não recebem essa exceção.

O revisor confirmou por leitura que não restaram achados P1/P2 concretos nessa
revisão. A execução dos testes foi feita pelo implementador; o revisor não executou
aplicativo/testes nem acessou dados operacionais. Isso não equivale a certificar
todas as possíveis falhas de filesystem ou regras comerciais históricas.

## Limites das garantias

- Demonstrados: recusa antes da troca para entradas inválidas; preservação ou
  recuperação do estado anterior nas falhas injetadas e interrupções de processo
  testadas; bloqueio do app atualizado durante restauração incompleta.
- Não há atomicidade entre recursos. Os testes não simulam perda física de energia,
  corrupção do disco ou destruição das próprias cópias anteriores. `sync()` depende
  do SO/dispositivo; não equivale a sincronizar todas as entradas de diretório.
- A proteção é cooperativa e local: versões antigas, scripts administrativos,
  `check:runtime`, acesso manual e outros clientes SQLite precisam estar parados.
  Não existe garantia para dois hosts ou arquivos sob sincronização/alteração externa.
- O sistema de arquivos, a origem congelada e os diretórios de recuperação devem
  ter acesso restrito ao operador. Checagens de links não eliminam corridas com
  um agente local capaz de trocar arquivos enquanto a operação está em andamento.
- Checksums conferem o histórico de migrações, não autenticam o conteúdo do backup.
  A validação não certifica todas as regras comerciais dos registros históricos,
  nem equivale a comparar todas as constraints/índices com um schema reconstruído.
- Imagens são verificadas por referência, extensão, assinatura e limite existente;
  não há decodificação completa nem certificação visual do arquivo.
- Um journal/lock truncado ou uma segunda queda no próprio guard exige inspeção
  manual. Os arquivos anteriores continuam preservados; não são apagados para
  permitir startup. PID reutilizado causa recusa segura.
- Históricos e uploads anteriores não têm retenção automática. Espaço em disco
  deve comportar staging, preservação e eventual cópia de volta; falta de espaço
  na recuperação mantém a operação bloqueada até intervenção.
- A disposição de staging foi projetada para volumes distintos, mas o teste não
  usa dois volumes físicos. Permissões e ENOSPC foram injetados, sem alterar ACLs.
- Nenhum banco, upload, backup verdadeiro, credencial ou sessão operacional foi
  consultado/modificado. WhatsApp real, migrações operacionais, push, deploy,
  merge e Lote 5 não foram executados.

## Procedimento operacional

1. Identifique a filial, o serviço NSSM e sua tarefa de backup. Faça uma cópia
   externa recuperável do estado anterior, incluindo sidecars existentes e fotos.
   Não dependa do mesmo disco para proteção contra defeito físico/energia.
2. Suspenda a tarefa da filial e pare seu serviço; aguarde o término do processo
   e de todos os scripts/clientes dessa instalação. Não pare outras filiais.
3. Confira espaço disponível, acesso exclusivo e permissões. Use uma pasta de
   backup v1 finalizada, fora dos destinos. Não remova WAL/SHM do estado atual.
4. Na pasta da instalação e com o código atualizado/build concluído, execute:

   ```powershell
   npm.cmd run restore -- 'C:\caminho\do\backup-da-filial' --confirm
   ```

5. Se houver falha/interrupção, mantenha serviço/tarefas parados e preserve todos
   os artefatos. Para recuperação automática do journal ou limpeza de lock órfão
   cujo processo terminou:

   ```powershell
   npm.cmd run restore -- --recover --confirm
   ```

   O recovery repete rollback com segurança. Uma operação já concluída ou revertida
   é reconhecida; ele não desfaz uma restauração concluída depois de novas vendas.
6. Se o próprio recovery cair, o guard fica bloqueado por segurança. Confirme por
   inspeção do SO que seu PID e todos os clientes terminaram; confira o caminho
   absoluto esperado e seu `owner.json`. Um operador pode remover somente esse
   arquivo e o diretório de guard vazio, sem recursão, e repetir `--recover`.
   Se o proprietário/journal não for legível, solicite inspeção técnica; não apague
   journals, snapshots ou locks em massa. Não execute comandos baseados em caminhos
   arbitrários lidos de JSON.
7. Somente após restauração ou recovery concluído, execute `npm.cmd run check:runtime`,
   confira banco, fotos, filial e saldos. Se aprovado, reinicie o serviço e reative
   a tarefa da filial. Guarde os caminhos informados para os anteriores.
8. Limpeza dos históricos é uma ação administrativa separada, após conferência
   e existência de cópia externa; este lote não implementa nem executa essa limpeza.

## Referências consultadas via Context7

- [SQLite: riscos de cópia/restauração durante transações](https://www.sqlite.org/howtocorrupt.html).
- [SQLite: WAL e seus arquivos acompanhantes](https://www.sqlite.org/wal.html).
- [SQLite: encerramento e limpeza do WAL](https://www.sqlite.org/walformat.html).
- [Node.js 24: ordenação de operações, rename e filehandle.sync](https://nodejs.org/docs/latest-v24.x/api/fs.html).

## Arquivos e Git

Alterados: `.gitignore`, `src/database/backup.ts`, `src/database/restoreBackup.ts`,
`src/index.ts`, `src/services/productPhotoStorage.ts`, `tests/backup.test.ts` e
`docs/PRODUCTION.md`. Novos: `src/database/backupValidation.ts`,
`src/database/maintenanceLock.ts`, `tests/restoreBackup.test.ts`,
`tests/restoreCrashWorker.ts` e este relatório.

HEAD `53c379c`, branch `melhorias/auditoria-tecnica`. Lote 4 sem commit; índice
vazio. Sem push, merge, deploy ou início do Lote 5.
Total de 12 arquivos neste lote: sete modificados e cinco novos.
