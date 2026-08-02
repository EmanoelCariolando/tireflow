[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$ServiceName,

  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,

  [Parameter(Mandatory = $true)]
  [ValidateLength(1, 80)]
  [string]$ExpectedBranchName,

  [string]$NodePath = 'C:\Program Files\nodejs\node.exe'
)

$ErrorActionPreference = 'Stop'
$script:ScheduledBackupLog = ''

function Write-ScheduledBackupLog {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [ValidateSet('INFO', 'ERROR')]
    [string]$Level = 'INFO'
  )

  $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Level, $Message
  Write-Host $line
  if ($script:ScheduledBackupLog) {
    Add-Content -LiteralPath $script:ScheduledBackupLog -Value $line -Encoding UTF8
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

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$EnvironmentFile,

    [Parameter(Mandatory = $true)]
    [string]$VariableName
  )

  $escapedName = [Regex]::Escape($VariableName)
  $matchingLine = Get-Content -LiteralPath $EnvironmentFile -Encoding UTF8 |
    Where-Object { $_ -match "^\s*$escapedName\s*=" } |
    Select-Object -Last 1

  if (-not $matchingLine) {
    return ''
  }

  $value = ($matchingLine -split '=', 2)[1].Trim()
  if ($value.Length -ge 2) {
    $firstCharacter = $value.Substring(0, 1)
    $lastCharacter = $value.Substring($value.Length - 1, 1)
    if (($firstCharacter -eq '"' -and $lastCharacter -eq '"') -or
        ($firstCharacter -eq "'" -and $lastCharacter -eq "'")) {
      return $value.Substring(1, $value.Length - 2)
    }
  }
  return $value
}

function Test-IsPathInside {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Candidate,

    [Parameter(Mandatory = $true)]
    [string]$Parent
  )

  $candidatePath = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
  $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
  return $candidatePath.Equals($parentPath, [StringComparison]::OrdinalIgnoreCase) -or
    $candidatePath.StartsWith("$parentPath\", [StringComparison]::OrdinalIgnoreCase)
}

if (-not (Test-IsFullyQualifiedWindowsPath $ProjectDirectory)) {
  throw "ProjectDirectory deve usar caminho absoluto: $ProjectDirectory"
}
if (-not (Test-Path -LiteralPath $ProjectDirectory -PathType Container)) {
  throw "Diretório do TireFlow não encontrado: $ProjectDirectory"
}
if ($ExpectedBranchName -match "[`r`n`0]") {
  throw 'ExpectedBranchName deve conter apenas uma linha.'
}

$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$nodeExecutable = Resolve-RequiredFile $NodePath 'node.exe'
$backupEntryPoint = Resolve-RequiredFile (Join-Path $projectRoot 'dist\database\backup.js') 'Backup compilado'
$environmentFile = Resolve-RequiredFile (Join-Path $projectRoot '.env') 'Arquivo .env'
$logDirectory = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$script:ScheduledBackupLog = Join-Path $logDirectory 'scheduled-backup.log'

$configuredBranchName = Get-DotEnvValue $environmentFile 'BRANCH_NAME'
if ($configuredBranchName -cne $ExpectedBranchName) {
  throw "BRANCH_NAME não corresponde à tarefa. Esperado: $ExpectedBranchName"
}

$configuredNodeEnvironment = Get-DotEnvValue $environmentFile 'NODE_ENV'
if ($configuredNodeEnvironment -cne 'production') {
  throw 'A tarefa automática exige NODE_ENV=production no .env.'
}

$configuredBackupRoot = Get-DotEnvValue $environmentFile 'BACKUP_ROOT'
if (-not $configuredBackupRoot -or -not (Test-IsFullyQualifiedWindowsPath $configuredBackupRoot)) {
  throw 'BACKUP_ROOT deve estar preenchido com um caminho absoluto fora do projeto.'
}
if (Test-IsPathInside $configuredBackupRoot $projectRoot) {
  throw 'BACKUP_ROOT não pode ficar dentro da pasta do projeto.'
}

if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
  throw "O serviço '$ServiceName' não existe."
}

$taskFailed = $false

Write-ScheduledBackupLog "Iniciando backup ao vivo de '$ExpectedBranchName'. O serviço '$ServiceName' não será interrompido."

try {
  Push-Location $projectRoot
  try {
    $backupOutput = @(& $nodeExecutable $backupEntryPoint 2>&1)
    $backupExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  foreach ($outputLine in $backupOutput) {
    Write-ScheduledBackupLog ([string]$outputLine)
  }
  if ($backupExitCode -ne 0) {
    throw "O processo de backup terminou com código $backupExitCode."
  }

  $backupPath = ''
  foreach ($outputLine in $backupOutput) {
    if ([string]$outputLine -match '^\[BACKUP_PATH\]\s+(.+)$') {
      $backupPath = $Matches[1].Trim()
    }
  }
  if (-not $backupPath -or -not (Test-Path -LiteralPath $backupPath -PathType Container)) {
    throw 'O processo terminou sem informar uma pasta de backup válida.'
  }

  $resolvedBackupRoot = (Resolve-Path -LiteralPath $configuredBackupRoot).Path
  $resolvedBackupPath = (Resolve-Path -LiteralPath $backupPath).Path
  if (-not (Test-IsPathInside $resolvedBackupPath $resolvedBackupRoot)) {
    throw 'O backup foi criado fora do BACKUP_ROOT configurado.'
  }

  $manifestPath = Join-Path $resolvedBackupPath 'backup-manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
  if ($manifest.branchName -cne $ExpectedBranchName) {
    throw 'O manifesto do backup pertence a outra filial.'
  }

  Write-ScheduledBackupLog "Backup diário concluído e validado: $resolvedBackupPath"
} catch {
  $taskFailed = $true
  Write-ScheduledBackupLog $_.Exception.Message 'ERROR'
}

if ($taskFailed) {
  exit 1
}

Write-ScheduledBackupLog 'Rotina de backup agendado finalizada com sucesso.'
exit 0
