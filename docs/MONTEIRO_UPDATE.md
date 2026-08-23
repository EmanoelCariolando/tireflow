# Atualização segura do servidor Monteiro

Este procedimento atualiza uma instalação que já possui banco, vendas, fotos e sessão do WhatsApp.
Ele não recria o banco e não executa seed.

## 1. Antes de começar

Confirme que estes itens pertencem a Monteiro e não serão substituídos durante a cópia do código:

- `.env`;
- arquivo SQLite indicado por `DATABASE_URL`;
- `data\wwebjs_auth` ou o caminho de `WHATSAPP_AUTH_DATA_PATH`;
- `uploads`;
- `logs`;
- backups existentes.

Copie para o servidor somente código, migrations, `package.json`, `package-lock.json` e
`data\seed\monteiro_products.csv`.

## 2. Parar somente Monteiro

Se estiver como serviço NSSM:

```powershell
Set-Location 'C:\TireFlow\Monteiro'
& 'C:\Tools\nssm\win64\nssm.exe' stop TireFlow-Monteiro
& 'C:\Tools\nssm\win64\nssm.exe' status TireFlow-Monteiro
```

Se estiver aberto com `npm run dev`, pressione `Ctrl+C` no terminal e aguarde o processo encerrar.

## 3. Configurar o `.env`

Preserve todos os valores atuais e acrescente ou ajuste somente:

```env
BRANCH_NAME="ATC PNEUS MONTEIRO"
INVENTORY_LOCATIONS_ENABLED=true
BACKUP_ROOT="C:\backups\tireflowmtr_snapshots"
```

Não altere `DATABASE_URL`, grupo, telefones ou caminhos da sessão.

## 4. Preparar o código e criar backup

Abra o PowerShell como Administrador na pasta de Monteiro:

```powershell
npm install
npx prisma generate
npm run backup
```

Não prossiga sem a mensagem `Backup concluído e verificado`. Anote o caminho exibido.

## 5. Migrar e validar

```powershell
npx prisma migrate deploy
npx prisma migrate status
npm run check
npm run check:runtime
```

O status deve informar que o schema está atualizado e os testes devem terminar sem falhas.

## 6. Conferir e aplicar localizações

Primeiro execute sem alterar o banco:

```powershell
npm run sync:locations -- data\seed\monteiro_products.csv
```

O resultado esperado é:

```text
Produtos com localização no CSV: 90
Produtos não encontrados: 0
```

Se houver produto não encontrado, não use `--apply`. Guarde a saída para corrigir a correspondência.

Com zero produtos não encontrados:

```powershell
npm run sync:locations -- data\seed\monteiro_products.csv --apply
npm run sync:locations -- data\seed\monteiro_products.csv
```

A última conferência deve mostrar `Localizações a atualizar: 0` e
`Localizações já corretas: 90`.

## 7. Zerar o estoque exclusivo do CG

Se for necessário zerar todo o estoque que pertence exclusivamente ao local `CG`, confira primeiro:

```powershell
npm run clear:location-stock -- CG
```

Depois de revisar a quantidade de produtos e unidades, aplique:

```powershell
npm run clear:location-stock -- CG --apply
```

O comando cria e verifica um backup antes da alteração, é bloqueado fora de Monteiro/MTR e não
altera produtos que também estejam associados a outro local.

### Desfazer a limpeza de um local

Para recuperar apenas o estoque e o local dos produtos usando o backup criado antes da limpeza,
pare o serviço e informe a pasta exata daquele backup. Confira primeiro, sem alterar o banco:

```powershell
npm run restore:location-stock -- "C:\backups\tireflowmtr_snapshots\AAAA-MM-DD_HH-MM-SS" CG
```

O resumo deve mostrar somente os produtos que estavam com estoque positivo e local exclusivo `CG`
no backup. A restauração é bloqueada se algum desses produtos tiver estoque atual diferente de zero
e diferente do backup. Depois de revisar a lista, aplique:

```powershell
npm run restore:location-stock -- "C:\backups\tireflowmtr_snapshots\AAAA-MM-DD_HH-MM-SS" CG --apply
```

O comando cria outro backup antes de gravar, restaura estoque e localização somente desses produtos
e preserva vendas, entradas, preços, fotos e os demais produtos.

Quando a conferência encontrar produtos movimentados depois do backup, `--apply-safe` pode ser usado
para restaurar somente os produtos sem conflito e manter os conflitantes exatamente como estão.

## 8. Iniciar e testar

Como serviço:

```powershell
& 'C:\Tools\nssm\win64\nssm.exe' start TireFlow-Monteiro
& 'C:\Tools\nssm\win64\nssm.exe' status TireFlow-Monteiro
```

No WhatsApp, teste:

```text
saude
pneu 165 70 13
local 1
```

A resposta do pneu em estoque deve continuar mostrando estoque e preços e, quando cadastrado,
também `📍 Local: CG`, `W3` ou `PMAIS`. Quando o produto estiver sem localização, a consulta
mostra `📍 Local: não cadastrado`; use `local <número>` para informar o local e confirme a
alteração. Escolha `1` para PMAIS, `2` para W3, `3` para cadastrar PMAIS e W3 ou `4` para CG. A
mesma opção aparece na lista de produtos com estoque zero.

## 9. Em caso de falha

- Não execute `seed:products`.
- Não apague banco, sessão ou uploads.
- Se a conferência de localizações falhar, o banco não terá sido modificado por ela.
- A migration adiciona somente uma coluna opcional; o sistema anterior ignora essa coluna.
- Guarde o caminho do backup e as mensagens do terminal antes de tentar restauração.
