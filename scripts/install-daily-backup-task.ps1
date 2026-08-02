[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$TaskName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$ServiceName,

  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,

  [Parameter(Mandatory = $true)]
  [ValidateLength(1, 80)]
  [string]$ExpectedBranchName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
  [string]$DailyAt,

  [string]$NodePath = 'C:\Program Files\nodejs\node.exe',

  [switch]$Replace
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abra o PowerShell como Administrador para instalar a tarefa.'
  }
}

function Test-IsFullyQualifiedWindowsPath {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $false
  }

  $pathUri = $null
  return [Uri]::TryCreate($PathValue, [UriKind]::Absolute, [ref]$pathUri) -and
    $pathUri.IsFile -and [IO.Path]::IsPathRooted($PathValue)
}

function Resolve-RequiredFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue,

    [Parameter(Mandatory = $true)]
    [string]$Description
  )

  if (-not (Test-IsFullyQualifiedWindowsPath $PathValue)) {
    throw "$Description deve usar caminho absoluto: $PathValue"
  }
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    throw "$Description não encontrado: $PathValue"
  }
  return (Resolve-Path -LiteralPath $PathValue).Path
}

Assert-Administrator

if (-not (Test-IsFullyQualifiedWindowsPath $ProjectDirectory)) {
  throw "ProjectDirectory deve usar caminho absoluto: $ProjectDirectory"
}
if (-not (Test-Path -LiteralPath $ProjectDirectory -PathType Container)) {
  throw "Diretório do TireFlow não encontrado: $ProjectDirectory"
}
if ($ExpectedBranchName -match "[`r`n`0`"]") {
  throw 'ExpectedBranchName contém caracteres não permitidos.'
}
if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
  throw 'Os comandos do Agendador de Tarefas do Windows não estão disponíveis.'
}
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
  throw "O serviço '$ServiceName' não existe."
}

$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$runnerPath = Resolve-RequiredFile (
  Join-Path $projectRoot 'scripts\run-scheduled-backup.ps1'
) 'Executor do backup agendado'
$nodeExecutable = Resolve-RequiredFile $NodePath 'node.exe'
Resolve-RequiredFile (Join-Path $projectRoot 'dist\database\backup.js') 'Backup compilado' | Out-Null
Resolve-RequiredFile (Join-Path $projectRoot '.env') 'Arquivo .env' | Out-Null

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and -not $Replace) {
  throw "A tarefa '$TaskName' já existe. Use -Replace somente se quiser atualizar sua configuração."
}

$powerShellExecutable = Resolve-RequiredFile (
  Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
) 'Windows PowerShell'
$actionArguments = (
  '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" ' +
  '-ServiceName "{1}" -ProjectDirectory "{2}" -ExpectedBranchName "{3}" -NodePath "{4}"'
) -f $runnerPath, $ServiceName, $projectRoot, $ExpectedBranchName, $nodeExecutable

$timeOfDay = [TimeSpan]::ParseExact(
  $DailyAt,
  'hh\:mm',
  [Globalization.CultureInfo]::InvariantCulture
)
$triggerAt = (Get-Date).Date.Add($timeOfDay)
$action = New-ScheduledTaskAction -Execute $powerShellExecutable -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerAt
$principal = New-ScheduledTaskPrincipal `
  -UserId 'SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew
$description = "Backup diário ao vivo e verificado de $ExpectedBranchName; sem interromper $ServiceName."
$scheduledTask = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description $description

$registrationParameters = @{
  TaskName = $TaskName
  InputObject = $scheduledTask
}
if ($Replace) {
  $registrationParameters.Force = $true
}
Register-ScheduledTask @registrationParameters | Out-Null

Write-Host ''
Write-Host "Tarefa instalada: $TaskName"
Write-Host "Filial esperada: $ExpectedBranchName"
Write-Host "Serviço identificado (não será interrompido): $ServiceName"
Write-Host "Horário diário: $DailyAt"
Write-Host "Projeto: $projectRoot"
Write-Host 'Conta: SYSTEM, com privilégios elevados'
Write-Host "Teste agora com: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Consulte com: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "Log: $projectRoot\logs\scheduled-backup.log"
