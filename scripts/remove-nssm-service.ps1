[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$ServiceName,

  [string]$NssmPath = 'C:\Tools\nssm\win64\nssm.exe',

  [switch]$ConfirmRemoval
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador para remover o serviço.'
}

if (-not $ConfirmRemoval) {
  throw 'A remoção exige -ConfirmRemoval. Nenhum arquivo, banco, upload ou sessão será apagado.'
}
if (-not [IO.Path]::IsPathFullyQualified($NssmPath) -or -not (Test-Path -LiteralPath $NssmPath -PathType Leaf)) {
  throw "nssm.exe não encontrado no caminho absoluto: $NssmPath"
}

$nssmExecutable = (Resolve-Path -LiteralPath $NssmPath).Path
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  throw "O serviço '$ServiceName' não existe."
}

if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
  & $nssmExecutable stop $ServiceName
  if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível parar '$ServiceName' corretamente. O serviço não foi removido."
  }
}

& $nssmExecutable remove $ServiceName confirm
if ($LASTEXITCODE -ne 0) {
  throw "Não foi possível remover '$ServiceName' (código $LASTEXITCODE)."
}

Write-Host "Serviço removido: $ServiceName"
Write-Host 'A pasta do projeto, o .env, o banco, os uploads, os logs e a sessão do WhatsApp foram preservados.'

