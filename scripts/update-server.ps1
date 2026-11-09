# Atualização segura (MTR ou Congo): para o serviço, faz backup, migra, gera o Prisma Client, valida e religa.
# Uso (PowerShell como Administrador, na pasta do sistema):
#   powershell -ExecutionPolicy Bypass -File scripts\update-server.ps1 -ServiceName TireFlow-Monteiro
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$ServiceName,
  [string]$NssmPath = 'C:\Tools\nssm\win64\nssm.exe'
)
$ErrorActionPreference = 'Stop'
function Step([string]$Name, [scriptblock]$Body) {
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Body
  if ($LASTEXITCODE -ne 0) { throw "Falhou em '$Name' (código $LASTEXITCODE). O serviço NÃO foi religado." }
}
Set-Location (Split-Path $PSScriptRoot -Parent)

if (Test-Path $NssmPath) { Step 'Parar serviço' { & $NssmPath stop $ServiceName } }
else { Write-Warning 'NSSM não encontrado: pare o bot manualmente (Ctrl+C) antes de continuar.'; Read-Host 'ENTER quando o bot estiver parado' | Out-Null }

Step 'Baixar código do GitHub' { git pull --ff-only }

# O Prisma Client SEMPRE é gerado antes do typecheck: client velho = centenas de erros de tipo (INNER_TUBE, TIRE_FLAP...).
Step 'npm install'        { npm.cmd install }
Step 'Backup verificado'  { npm.cmd run backup }
Step 'Migrar banco'       { npx.cmd prisma migrate deploy }
Step 'Gerar Prisma Client'{ npx.cmd prisma generate }
Step 'Typecheck + testes + build' { npm.cmd run check }

if (Test-Path $NssmPath) { Step 'Iniciar serviço' { & $NssmPath start $ServiceName } }
Write-Host 'Atualização concluída.' -ForegroundColor Green
