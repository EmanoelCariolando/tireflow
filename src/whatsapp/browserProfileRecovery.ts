import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_PROCESS_QUERY_TIMEOUT_MS = 10_000;
const WINDOWS_PROCESS_STOP_TIMEOUT_MS = 10_000;
const PROFILE_PATH_ENVIRONMENT_VARIABLE = 'TIREFLOW_RECOVERY_PROFILE_PATH';
const WINDOWS_DIRECTORY = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
const WINDOWS_POWERSHELL_PATH = path.join(
  WINDOWS_DIRECTORY,
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const WINDOWS_TASKKILL_PATH = path.join(WINDOWS_DIRECTORY, 'System32', 'taskkill.exe');

const WINDOWS_PROCESS_QUERY = String.raw`
$profilePath = [IO.Path]::GetFullPath($env:TIREFLOW_RECOVERY_PROFILE_PATH)
$allProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$matchingBrowsers = @($allProcesses | Where-Object {
  $_.Name -ieq 'chrome.exe' -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
  $_.CommandLine -notmatch '(?:^|\s)--type='
})
$result = @($matchingBrowsers | ForEach-Object {
  $browser = $_
  $parent = $allProcesses | Where-Object { $_.ProcessId -eq $browser.ParentProcessId } | Select-Object -First 1
  [PSCustomObject]@{
    processId = [int]$browser.ProcessId
    parentProcessId = [int]$browser.ParentProcessId
    parentExists = [bool]($null -ne $parent)
    creationTime = if ($browser.CreationDate) { ([datetime]$browser.CreationDate).ToUniversalTime().ToString('o') } else { '' }
    parentCreationTime = if ($parent -and $parent.CreationDate) { ([datetime]$parent.CreationDate).ToUniversalTime().ToString('o') } else { '' }
  }
})
ConvertTo-Json -InputObject $result -Compress
`;

export interface BrowserProcessSnapshot {
  processId: number;
  parentProcessId: number;
  parentExists: boolean;
  creationTime: string;
  parentCreationTime: string;
}

export interface BrowserProcessClassification {
  active: BrowserProcessSnapshot[];
  orphaned: BrowserProcessSnapshot[];
  spawnedByCurrentProcess: BrowserProcessSnapshot[];
}

export type BrowserProfileRecoveryResult =
  | 'recovered_orphan'
  | 'removed_stale_lock'
  | 'active_owner'
  | 'nothing_to_recover'
  | 'unsupported'
  | 'inspection_failed';

export interface BrowserProfileRecoveryOptions {
  platform?: NodeJS.Platform;
  currentProcessId?: number;
  inspectProcesses?: (profilePath: string) => Promise<BrowserProcessSnapshot[]>;
  stopProcessTree?: (processId: number) => Promise<void>;
}

function runExecutable(
  executable: string,
  args: string[],
  options: { environment?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        env: options.environment,
        timeout: options.timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isValidSnapshot(value: unknown): value is BrowserProcessSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<BrowserProcessSnapshot>;
  return (
    Number.isSafeInteger(snapshot.processId) &&
    Number(snapshot.processId) > 0 &&
    Number.isSafeInteger(snapshot.parentProcessId) &&
    Number(snapshot.parentProcessId) >= 0 &&
    typeof snapshot.parentExists === 'boolean' &&
    typeof snapshot.creationTime === 'string' &&
    typeof snapshot.parentCreationTime === 'string'
  );
}

function parseWindowsProcessSnapshots(output: string): BrowserProcessSnapshot[] {
  if (!output.trim()) return [];
  const parsed: unknown = JSON.parse(output);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (!values.every(isValidSnapshot)) {
    throw new Error('Windows returned an invalid browser process list.');
  }
  return values;
}

function timestamp(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A live parent means another process still owns the browser. A parent
 * timestamp newer than Chrome is the safe exception: Windows reused the old
 * parent PID after the original owner exited.
 */
export function classifyBrowserProcesses(
  snapshots: BrowserProcessSnapshot[],
  currentProcessId: number,
): BrowserProcessClassification {
  const result: BrowserProcessClassification = {
    active: [],
    orphaned: [],
    spawnedByCurrentProcess: [],
  };

  for (const snapshot of snapshots) {
    if (snapshot.parentProcessId === currentProcessId) {
      result.spawnedByCurrentProcess.push(snapshot);
      continue;
    }

    const browserCreatedAt = timestamp(snapshot.creationTime);
    const parentCreatedAt = timestamp(snapshot.parentCreationTime);
    const parentPidWasReused =
      browserCreatedAt !== undefined &&
      parentCreatedAt !== undefined &&
      parentCreatedAt > browserCreatedAt;
    if (!snapshot.parentExists || parentPidWasReused) {
      result.orphaned.push(snapshot);
    } else {
      result.active.push(snapshot);
    }
  }

  return result;
}

export function isExpectedBrowserProfileConflict(error: unknown, profilePath: string): boolean {
  if (!(error instanceof Error)) return false;
  const normalizedMessage = error.message.toLocaleLowerCase('en-US');
  const normalizedProfilePath = path.resolve(profilePath).toLocaleLowerCase('en-US');
  return (
    normalizedMessage.includes('the browser is already running for') &&
    normalizedMessage.includes(normalizedProfilePath)
  );
}

async function inspectWindowsBrowserProcesses(profilePath: string): Promise<BrowserProcessSnapshot[]> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    [PROFILE_PATH_ENVIRONMENT_VARIABLE]: path.resolve(profilePath),
  };
  const output = await runExecutable(
    WINDOWS_POWERSHELL_PATH,
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_QUERY],
    { environment, timeoutMs: WINDOWS_PROCESS_QUERY_TIMEOUT_MS },
  );
  return parseWindowsProcessSnapshots(output);
}

export async function forceStopBrowserProcessTree(processId: number): Promise<void> {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error(`Invalid browser process id: ${processId}`);
  }

  if (process.platform === 'win32') {
    await runExecutable(
      WINDOWS_TASKKILL_PATH,
      ['/PID', String(processId), '/T', '/F'],
      { timeoutMs: WINDOWS_PROCESS_STOP_TIMEOUT_MS },
    );
    return;
  }

  process.kill(processId, 'SIGKILL');
}

async function removeProfileLock(profilePath: string): Promise<boolean> {
  const lockPath = path.join(profilePath, 'lockfile');
  if (!existsSync(lockPath)) return false;
  await rm(lockPath, { force: true });
  return true;
}

/**
 * Recovers only Chrome's ProcessSingleton lock. Authentication data is never
 * removed. A browser with a live original parent is preserved because it may
 * belong to another valid TireFlow instance.
 */
export async function recoverBrowserProfile(
  profilePath: string,
  options: BrowserProfileRecoveryOptions = {},
): Promise<BrowserProfileRecoveryResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return 'unsupported';

  const currentProcessId = options.currentProcessId ?? process.pid;
  const inspectProcesses = options.inspectProcesses ?? inspectWindowsBrowserProcesses;
  const stopProcessTree = options.stopProcessTree ?? forceStopBrowserProcessTree;

  try {
    const initialSnapshots = await inspectProcesses(profilePath);
    const initial = classifyBrowserProcesses(initialSnapshots, currentProcessId);

    if (initial.active.length > 0) {
      return 'active_owner';
    }

    let stoppedOrphan = false;
    const recoverableProcesses = [...initial.orphaned, ...initial.spawnedByCurrentProcess];
    for (const orphan of recoverableProcesses) {
      await stopProcessTree(orphan.processId);
      stoppedOrphan = true;
    }

    const remainingSnapshots = await inspectProcesses(profilePath);
    const remaining = classifyBrowserProcesses(remainingSnapshots, currentProcessId);
    if (
      remaining.active.length > 0 ||
      remaining.orphaned.length > 0 ||
      remaining.spawnedByCurrentProcess.length > 0
    ) {
      return 'active_owner';
    }

    const removedLock = await removeProfileLock(profilePath);
    if (stoppedOrphan) return 'recovered_orphan';
    if (removedLock) return 'removed_stale_lock';
    return 'nothing_to_recover';
  } catch (error) {
    console.error('[WHATSAPP] Could not inspect or recover the locked Chrome profile.', error);
    return 'inspection_failed';
  }
}
