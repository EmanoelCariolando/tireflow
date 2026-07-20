[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_-]+$')]
  [string]$ServiceName,

  [Parameter(Mandatory = $true)]
  [string]$ProjectDirectory,

  [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
  [string]$NssmPath = 'C:\Tools\nssm\win64\nssm.exe'
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abra o PowerShell como Administrador para instalar o serviço.'
  }
}

function Resolve-RequiredFile([string]$PathValue, [string]$Description) {
  if (-not [IO.Path]::IsPathFullyQualified($PathValue)) {
    throw "$Description deve usar caminho absoluto: $PathValue"
  }
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    throw "$Description não encontrado: $PathValue"
  }
  return (Resolve-Path -LiteralPath $PathValue).Path
}

function Invoke-Nssm([string[]]$Arguments) {
  & $script:NssmExecutable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "NSSM falhou (código $LASTEXITCODE): $($Arguments -join ' ')"
  }
}

Assert-Administrator

if (-not [IO.Path]::IsPathFullyQualified($ProjectDirectory)) {
  throw "ProjectDirectory deve usar caminho absoluto: $ProjectDirectory"
}
if (-not (Test-Path -LiteralPath $ProjectDirectory -PathType Container)) {
  throw "Diretório do TireFlow não encontrado: $ProjectDirectory"
}

$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$script:NssmExecutable = Resolve-RequiredFile $NssmPath 'nssm.exe'
$nodeExecutable = Resolve-RequiredFile $NodePath 'node.exe'
$entryPoint = Resolve-RequiredFile (Join-Path $projectRoot 'dist\index.js') 'Aplicação compilada'
$runtimeCheck = Resolve-RequiredFile (Join-Path $projectRoot 'dist\runtimeCheck.js') 'Validador compilado'
$environmentFile = Resolve-RequiredFile (Join-Path $projectRoot '.env') 'Arquivo .env'
$logDirectory = Join-Path $projectRoot 'logs'
$stdoutPath = Join-Path $logDirectory 'nssm-stdout.log'
$stderrPath = Join-Path $logDirectory 'nssm-stderr.log'

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  throw "O serviço '$ServiceName' já existe. Remova-o antes de instalar novamente."
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

Write-Host 'Validando a instalação antes de criar o serviço...'
$previousNodeEnv = $env:NODE_ENV
$env:NODE_ENV = 'production'
Push-Location $projectRoot
try {
  & $nodeExecutable $runtimeCheck
  if ($LASTEXITCODE -ne 0) {
    throw "A validação da instalação falhou (código $LASTEXITCODE)."
  }
}
finally {
  Pop-Location
  $env:NODE_ENV = $previousNodeEnv
}

$serviceCreated = $false
try {
  Invoke-Nssm @('install', $ServiceName, $nodeExecutable)
  $serviceCreated = $true
  Invoke-Nssm @('set', $ServiceName, 'AppParameters', ('"{0}"' -f $entryPoint))
  Invoke-Nssm @('set', $ServiceName, 'AppDirectory', $projectRoot)
  Invoke-Nssm @('set', $ServiceName, 'AppEnvironmentExtra', 'NODE_ENV=production', 'LOG_TO_CONSOLE=false')
  Invoke-Nssm @('set', $ServiceName, 'AppStdout', $stdoutPath)
  Invoke-Nssm @('set', $ServiceName, 'AppStderr', $stderrPath)
  Invoke-Nssm @('set', $ServiceName, 'AppRotateFiles', '0')
  Invoke-Nssm @('set', $ServiceName, 'AppExit', 'Default', 'Restart')
  Invoke-Nssm @('set', $ServiceName, 'AppRestartDelay', '5000')
  Invoke-Nssm @('set', $ServiceName, 'Start', 'SERVICE_AUTO_START')
  Invoke-Nssm @('set', $ServiceName, 'AppStopMethodSkip', '0')
  Invoke-Nssm @('set', $ServiceName, 'AppStopMethodConsole', '15000')
  Invoke-Nssm @('set', $ServiceName, 'AppStopMethodWindow', '1500')
  Invoke-Nssm @('set', $ServiceName, 'AppStopMethodThreads', '1500')
  Invoke-Nssm @('set', $ServiceName, 'AppKillProcessTree', '1')
  Invoke-Nssm @('set', $ServiceName, 'DisplayName', "$ServiceName - TireFlow")
  Invoke-Nssm @('set', $ServiceName, 'Description', "TireFlow executado diretamente por Node.js em $projectRoot")
}
catch {
  if ($serviceCreated) {
    & $script:NssmExecutable remove $ServiceName confirm | Out-Null
  }
  throw
}

Write-Host ''
Write-Host "Serviço instalado: $ServiceName"
Write-Host "node.exe: $nodeExecutable"
Write-Host "entrada: $entryPoint"
Write-Host "diretório de trabalho: $projectRoot"
Write-Host "configuração: $environmentFile"
Write-Host "stdout: $stdoutPath"
Write-Host "stderr: $stderrPath"
Write-Host "logs rotativos da aplicação: $logDirectory\tireflow-AAAA-MM-DD.log"
Write-Host "Inicie com: & '$script:NssmExecutable' start '$ServiceName'"

