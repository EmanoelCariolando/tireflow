[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$TaskName,

  [switch]$ConfirmRemoval
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador para remover a tarefa.'
}

if (-not $ConfirmRemoval) {
  throw 'A remoção exige -ConfirmRemoval. Backups existentes não serão apagados.'
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "A tarefa '$TaskName' não existe."
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "Tarefa removida: $TaskName"
Write-Host 'Backups, banco, fotos, .env, logs, sessão do WhatsApp e serviço NSSM foram preservados.'
