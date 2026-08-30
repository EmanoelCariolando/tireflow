import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STARTUP_RECOVERY_STATE_PATH } from '../config/appPaths.js';

const STATE_VERSION = 1;
const FAILURE_WINDOW_MS = 30 * 60 * 1000;
const STABILITY_RESET_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [0, 15_000, 30_000, 60_000, 120_000] as const;

interface StartupRecoveryState {
  version: typeof STATE_VERSION;
  consecutiveFailures: number;
  lastFailureAt: string;
  lastReason: string;
}

interface StartupRecoveryOptions {
  statePath?: string;
  nowMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

let stabilityResetTimer: NodeJS.Timeout | undefined;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeReason(reason: string): string {
  return reason.replace(/[\r\n\0]/g, ' ').slice(0, 80) || 'UNKNOWN';
}

function isStartupRecoveryState(value: unknown): value is StartupRecoveryState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<StartupRecoveryState>;
  return (
    state.version === STATE_VERSION &&
    Number.isSafeInteger(state.consecutiveFailures) &&
    Number(state.consecutiveFailures) > 0 &&
    typeof state.lastFailureAt === 'string' &&
    Number.isFinite(Date.parse(state.lastFailureAt)) &&
    typeof state.lastReason === 'string'
  );
}

async function readState(statePath: string): Promise<StartupRecoveryState | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath, 'utf8'));
    return isStartupRecoveryState(parsed) ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[STARTUP_RECOVERY] Ignoring an unreadable recovery state file.');
    }
    return undefined;
  }
}

export function getStartupRetryDelayMs(consecutiveFailures: number): number {
  const safeCount = Math.max(1, Math.floor(consecutiveFailures));
  return RETRY_DELAYS_MS[Math.min(safeCount - 1, RETRY_DELAYS_MS.length - 1)];
}

function isRecentFailure(state: StartupRecoveryState, nowMs: number): boolean {
  const elapsed = nowMs - Date.parse(state.lastFailureAt);
  return elapsed >= 0 && elapsed <= FAILURE_WINDOW_MS;
}

export async function waitForStartupRecoveryWindow(
  options: StartupRecoveryOptions = {},
): Promise<number> {
  const statePath = options.statePath ?? STARTUP_RECOVERY_STATE_PATH;
  const nowMs = options.nowMs ?? Date.now();
  const state = await readState(statePath);
  if (!state) return 0;

  if (!isRecentFailure(state, nowMs)) {
    await rm(statePath, { force: true }).catch(() => undefined);
    return 0;
  }

  const delayMs = getStartupRetryDelayMs(state.consecutiveFailures);
  if (delayMs === 0) return 0;
  console.warn('[STARTUP_RECOVERY] Delaying startup after consecutive failure.', {
    attempt: state.consecutiveFailures + 1,
    previousReason: state.lastReason,
    delaySeconds: Math.round(delayMs / 1000),
  });
  await (options.sleep ?? wait)(delayMs);
  return delayMs;
}

export async function recordStartupFailure(
  reason: string,
  options: StartupRecoveryOptions = {},
): Promise<number> {
  const statePath = options.statePath ?? STARTUP_RECOVERY_STATE_PATH;
  const nowMs = options.nowMs ?? Date.now();
  const previous = await readState(statePath);
  const consecutiveFailures = previous && isRecentFailure(previous, nowMs)
    ? previous.consecutiveFailures + 1
    : 1;
  const state: StartupRecoveryState = {
    version: STATE_VERSION,
    consecutiveFailures,
    lastFailureAt: new Date(nowMs).toISOString(),
    lastReason: safeReason(reason),
  };

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8');
  console.warn('[STARTUP_RECOVERY] Failure recorded for controlled retry.', {
    reason: state.lastReason,
    consecutiveFailures,
    nextDelaySeconds: Math.round(getStartupRetryDelayMs(consecutiveFailures) / 1000),
  });
  return consecutiveFailures;
}

export async function clearStartupRecoveryState(
  options: Pick<StartupRecoveryOptions, 'statePath'> = {},
): Promise<void> {
  await rm(options.statePath ?? STARTUP_RECOVERY_STATE_PATH, { force: true });
}

export function scheduleStartupRecoveryReset(delayMs = STABILITY_RESET_MS): void {
  cancelStartupRecoveryReset();
  stabilityResetTimer = setTimeout(() => {
    stabilityResetTimer = undefined;
    void clearStartupRecoveryState()
      .then(() => console.log('[STARTUP_RECOVERY] Stability window reached; failure counter cleared.'))
      .catch((error: unknown) => {
        console.error('[STARTUP_RECOVERY] Could not clear the failure counter.', error);
      });
  }, delayMs);
  stabilityResetTimer.unref();
}

export function cancelStartupRecoveryReset(): void {
  if (!stabilityResetTimer) return;
  clearTimeout(stabilityResetTimer);
  stabilityResetTimer = undefined;
}
