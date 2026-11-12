[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('status', 'start', 'stop', 'restart')][string]$Action,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]{1,80}$')][string]$ServiceName,
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [Parameter(Mandatory = $true)][string]$NssmPath,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Read-NssmValue([string]$Setting) {
  $result = @(& $NssmPath get $ServiceName $Setting 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'NSSM configuration unavailable.' }
  return (($result -join "`n") -replace "`0", "").Trim()
}

function Get-ProcessStatus {
  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  if (-not $service) { throw 'Service unavailable.' }
  $state = 'error'
  $childId = $null
  $uptime = $null
  switch ($service.State) {
    'Stopped' { $state = 'offline' }
    'Start Pending' { $state = 'starting' }
    'Stop Pending' { $state = 'stopping' }
    'Running' {
      $state = 'starting'
      $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($service.ProcessId) AND Name='node.exe'")
      $expectedEntry = Join-Path $ProjectDirectory 'dist\index.js'
      foreach ($child in $children) {
        # The NSSM wrapper being alive alone does not mean the bot is running.
        if ($child.ExecutablePath -ieq $NodePath -and $child.CommandLine.IndexOf($expectedEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          $state = 'online'
          $childId = [int]$child.ProcessId
          $uptime = [Math]::Max(0, [int]((Get-Date) - $child.CreationDate).TotalSeconds)
          break
        }
      }
    }
  }
  return @{ state = $state; pid = $childId; uptimeSeconds = $uptime; canControl = $script:CanControl }
}

try {
  foreach ($filename in @($NssmPath, $NodePath, (Join-Path $ProjectDirectory 'dist\index.js'))) {
    if (-not [IO.Path]::IsPathRooted($filename) -or -not (Test-Path -LiteralPath $filename -PathType Leaf)) {
      throw 'Installation paths unavailable.'
    }
  }
  $ProjectDirectory = (Resolve-Path -LiteralPath $ProjectDirectory).Path.TrimEnd('\')
  $installedService = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
  if (-not $installedService -or $installedService.PathName.Trim('"') -ine $NssmPath) { throw 'Service does not use configured NSSM.' }
  if ((Read-NssmValue 'AppDirectory').TrimEnd('\') -ine $ProjectDirectory -or
      (Read-NssmValue 'Application') -ine $NodePath -or
      (Read-NssmValue 'AppParameters').Trim('"') -ine (Join-Path $ProjectDirectory 'dist\index.js')) {
    throw 'Service belongs to another installation.'
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $script:CanControl = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($Action -ne 'status') {
    if (-not $script:CanControl) { throw 'Administrator permission required.' }
    & $NssmPath $Action $ServiceName 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'NSSM action failed.' }
    $expected = if ($Action -eq 'stop') { 'offline' } else { 'online' }
    $deadline = (Get-Date).AddSeconds(45)
    do {
      $result = Get-ProcessStatus
      if ($result.state -eq $expected) { break }
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
  } else { $result = Get-ProcessStatus }
  $result | ConvertTo-Json -Compress
} catch {
  # Do not return native command output, paths or service account details to HTTP.
  [Console]::Error.WriteLine('Service inspection or action failed. Validate local configuration and Windows permissions.')
  exit 1
}
