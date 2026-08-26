import whatsappWeb from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { ConsoleMessage, HTTPRequest, Page } from 'puppeteer';
import env from '../config/env.js';
import {
  forceStopBrowserProcessTree,
  isExpectedBrowserProfileConflict,
  recoverBrowserProfile,
  type BrowserProfileRecoveryResult,
} from './browserProfileRecovery.js';

const { Client, LocalAuth } = whatsappWeb;

// Large accounts can spend several minutes restoring and synchronizing after a
// computer restart. Do not force NSSM into a restart loop during that window.
const START_TIMEOUT_MS = 600_000;
const SHUTDOWN_TIMEOUT_MS = 5000;
const BROWSER_EXIT_TIMEOUT_MS = 3000;
const BROWSER_FORCE_EXIT_TIMEOUT_MS = 3000;
const READY_RECOVERY_DELAY_MS = 15_000;
const READY_RECOVERY_RETRY_MS = 5000;
const PROFILE_CONFLICT_MIN_RETRY_MS = 5000;
const PROFILE_CONFLICT_MAX_RETRY_MS = 120_000;
let diagnosticsAttached = false;
let diagnosticsAttaching = false;
let whatsappReady = false;

const WHATSAPP_PROFILE_PATH = path.join(
  env.whatsappAuthDataPath,
  `session-${env.whatsappSessionName}`,
);

interface WhatsAppPageDiagnostics {
  url: string;
  title: string;
  readyState: string;
  visibleText: string;
  authStore: string;
  wwebjs: string;
  require: string;
  socketState: string;
  socketStream: string;
  hasSynced: string;
  offlineProgress: string;
}

interface WhatsAppClientInternals {
  attachEventListeners(): Promise<void>;
  info?: unknown;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout;
  const result = Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${milliseconds}ms`));
      }, milliseconds);
    }),
  ]);
  return result.finally(() => clearTimeout(timeout));
}

function shorten(value: string, maxLength = 700): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLockedSessionCleanupError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('EBUSY') || message.includes('EPERM') || message.includes('resource busy or locked');
}

function isNoisyRequestFailure(errorText: string, url: string): boolean {
  return errorText === 'net::ERR_ABORTED' && url.includes('/emoji/');
}

function createResilientLocalAuth(): InstanceType<typeof LocalAuth> {
  const auth = new LocalAuth({
    clientId: env.whatsappSessionName,
    dataPath: env.whatsappAuthDataPath,
    rmMaxRetries: 20,
  });
  const originalLogout = auth.logout.bind(auth);

  auth.logout = async (): Promise<void> => {
    try {
      await originalLogout();
    } catch (error) {
      if (isLockedSessionCleanupError(error)) {
        console.warn(
          'WhatsApp LocalAuth session cleanup was skipped because Chrome still holds a session file. Restart the bot and scan the QR code if WhatsApp asks for it.',
        );
        console.warn('LocalAuth cleanup error:', getErrorMessage(error));
        return;
      }

      throw error;
    }
  };

  return auth;
}

async function waitForPuppeteerPage(): Promise<Page | undefined> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (whatsappClient.pupPage) {
      return whatsappClient.pupPage;
    }

    await wait(100);
  }

  return undefined;
}

async function attachBrowserDiagnostics(): Promise<void> {
  if (diagnosticsAttached || diagnosticsAttaching || !env.whatsappDebug) {
    return;
  }

  diagnosticsAttaching = true;
  try {
    const page = await waitForPuppeteerPage();

    if (!page || diagnosticsAttached) {
      return;
    }

    diagnosticsAttached = true;

    page.on('console', (message: ConsoleMessage) => {
      const type = message.type();

      if (type === 'error' || type === 'warn') {
        console.log(`[WA PAGE ${type}] ${shorten(message.text())}`);
      }
    });

    page.on('pageerror', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[WA PAGE ERROR] ${message}`);
    });

    page.on('requestfailed', (request: HTTPRequest) => {
      const failure = request.failure();
      const errorText = failure?.errorText || 'unknown';
      const url = request.url();

      if (isNoisyRequestFailure(errorText, url)) {
        return;
      }

      console.error(`[WA REQUEST FAILED] ${errorText} ${shorten(url)}`);
    });
  } finally {
    diagnosticsAttaching = false;
  }
}

async function readWhatsAppPageDiagnostics(): Promise<WhatsAppPageDiagnostics | undefined> {
  const page = whatsappClient.pupPage;

  if (!page) {
    console.error('WhatsApp page diagnostics unavailable: Puppeteer page was not created.');
    return undefined;
  }

  try {
    return await page.evaluate(`
      (() => {
        const hasValue = (name) => {
          try {
            return globalThis[name] === undefined ? 'undefined' : 'available';
          } catch {
            return 'error';
          }
        };

        const readSocketValue = (key) => {
          try {
            const value = globalThis.require?.('WAWebSocketModel')?.Socket?.[key];
            return value === undefined || value === null ? String(value) : String(value);
          } catch {
            return 'error';
          }
        };

        const readOfflineProgress = () => {
          try {
            return String(globalThis.AuthStore?.OfflineMessageHandler?.getOfflineDeliveryProgress?.());
          } catch {
            return 'error';
          }
        };

        return {
          url: globalThis.location.href,
          title: globalThis.document.title,
          readyState: globalThis.document.readyState,
          visibleText: globalThis.document.body?.innerText?.slice(0, 500) || '',
          authStore: hasValue('AuthStore'),
          wwebjs: hasValue('WWebJS'),
          require: typeof globalThis.require,
          socketState: readSocketValue('state'),
          socketStream: readSocketValue('stream'),
          hasSynced: readSocketValue('hasSynced'),
          offlineProgress: readOfflineProgress(),
        };
      })()
    `) as WhatsAppPageDiagnostics;
  } catch (error) {
    console.error('Could not read WhatsApp page diagnostics:', error);
    return undefined;
  }
}

async function logWhatsAppPageDiagnostics(): Promise<void> {
  const diagnostics = await readWhatsAppPageDiagnostics();

  console.error('WhatsApp page diagnostics:', diagnostics);
}

async function attachMessageListenersManually(): Promise<boolean> {
  const diagnostics = await readWhatsAppPageDiagnostics();

  console.error('WhatsApp page diagnostics:', diagnostics);

  if (
    diagnostics?.readyState !== 'complete' ||
    diagnostics.authStore !== 'available' ||
    diagnostics.wwebjs !== 'available' ||
    diagnostics.require !== 'function' ||
    !(whatsappClient as unknown as WhatsAppClientInternals).info
  ) {
    return false;
  }

  try {
    await (whatsappClient as unknown as WhatsAppClientInternals).attachEventListeners();
    console.warn('WhatsApp Web listeners were attached manually after ready event did not fire.');
    return true;
  } catch (error) {
    console.error('Could not attach WhatsApp Web listeners manually:', error);
    return false;
  }
}

function createReadyOrManualAttachPromise(): Promise<void> {
  return new Promise((resolve, reject) => {
    let recoveryTimeout: NodeJS.Timeout | undefined;
    let recoveryRunning = false;
    let settled = false;

    function scheduleRecovery(delay: number): void {
      if (settled) return;
      if (recoveryTimeout) clearTimeout(recoveryTimeout);
      recoveryTimeout = setTimeout(() => void attemptRecovery(), delay);
    }

    async function attemptRecovery(): Promise<void> {
      if (settled || recoveryRunning) return;
      recoveryRunning = true;

      try {
        const attached = await attachMessageListenersManually();
        if (attached) {
          markWhatsAppReady('manual recovery');
          finish();
          return;
        }
      } catch (error) {
        console.error('Could not recover WhatsApp readiness:', error);
      } finally {
        recoveryRunning = false;
      }

      scheduleRecovery(READY_RECOVERY_RETRY_MS);
    }

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (recoveryTimeout) {
        clearTimeout(recoveryTimeout);
      }

      whatsappClient.removeListener('authenticated', onAuthenticated);
      whatsappClient.removeListener('ready', onReady);
      whatsappClient.removeListener('auth_failure', onAuthFailure);
      whatsappClient.removeListener('disconnected', onDisconnected);
      resolve();
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      if (recoveryTimeout) clearTimeout(recoveryTimeout);
      whatsappClient.removeListener('authenticated', onAuthenticated);
      whatsappClient.removeListener('ready', onReady);
      whatsappClient.removeListener('auth_failure', onAuthFailure);
      whatsappClient.removeListener('disconnected', onDisconnected);
      reject(error);
    };

    const onReady = (): void => {
      markWhatsAppReady('ready event');
      finish();
    };

    const onAuthenticated = (): void => {
      scheduleRecovery(READY_RECOVERY_DELAY_MS);
    };

    const onAuthFailure = (message: string): void => {
      fail(new Error(`WhatsApp authentication failed: ${message}`));
    };

    const onDisconnected = (reason: string): void => {
      fail(new Error(`WhatsApp disconnected before becoming ready: ${reason}`));
    };

    whatsappClient.once('ready', onReady);
    whatsappClient.once('authenticated', onAuthenticated);
    whatsappClient.once('auth_failure', onAuthFailure);
    whatsappClient.once('disconnected', onDisconnected);
  });
}

function browserProcessHasExited(browserProcess: ChildProcess): boolean {
  return browserProcess.exitCode !== null || browserProcess.signalCode !== null;
}

async function waitForBrowserProcessExit(
  browserProcess: ChildProcess,
  milliseconds: number,
): Promise<boolean> {
  if (browserProcessHasExited(browserProcess)) return true;

  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      browserProcess.removeListener('exit', onExit);
      resolve(browserProcessHasExited(browserProcess));
    }, milliseconds);
    browserProcess.once('exit', onExit);
  });
}

function profileConflictRetryDelay(conflictCount: number, recovery: BrowserProfileRecoveryResult): number {
  if (recovery === 'recovered_orphan' || recovery === 'removed_stale_lock') {
    return PROFILE_CONFLICT_MIN_RETRY_MS;
  }
  return Math.min(
    PROFILE_CONFLICT_MIN_RETRY_MS * (2 ** Math.min(conflictCount - 1, 5)),
    PROFILE_CONFLICT_MAX_RETRY_MS,
  );
}

function markWhatsAppReady(source: 'ready event' | 'manual recovery'): void {
  if (whatsappReady) return;
  whatsappReady = true;
  console.log('✅ WhatsApp client is ready!');
  console.log('🤖 TireFlow bot is now listening for messages.');
  if (source === 'manual recovery') {
    console.warn('WhatsApp readiness was restored after the ready event did not fire.');
  }
  console.log('');
}

/**
 * WhatsApp client instance.
 * Uses LocalAuth to persist session between restarts.
 * This avoids needing to scan the QR code every time.
 */
export const whatsappClient = new Client({
  authStrategy: createResilientLocalAuth(),
  webVersion: env.whatsappWebVersion || undefined,
  webVersionCache: {
    type: 'local',
    path: './.wwebjs_cache/',
    strict: Boolean(env.whatsappWebVersion),
  },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  puppeteer: {
    headless: env.whatsappHeadless,
    defaultViewport: null,
    executablePath: env.chromeExecutablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disk-cache-size=0',
      '--media-cache-size=0',
    ],
  },
});

/**
 * Initialize WhatsApp client event listeners for Phase 1.
 */
export function initializeWhatsAppClient(): void {
  // Show QR code in terminal when authentication is needed
  whatsappClient.on('qr', (qr: string) => {
    console.log('\n📱 Scan this QR code with your WhatsApp to authenticate:\n');
    // Print directly to the terminal so the authentication token is never written to application logs.
    qrcode.generate(qr, { small: true }, (qrOutput: string) => {
      process.stdout.write(`${qrOutput}\n`);
    });
    console.log('\nWaiting for authentication...\n');
  });

  // Client is ready to receive messages
  whatsappClient.on('ready', () => {
    markWhatsAppReady('ready event');
  });

  whatsappClient.on('authenticated', () => {
    console.log('✅ WhatsApp authentication successful.');
  });

  // Handle authentication failures
  whatsappClient.on('auth_failure', (msg: string) => {
    whatsappReady = false;
    console.error('❌ Authentication failed:', msg);
  });

  // Handle disconnection
  whatsappClient.on('disconnected', (reason: string) => {
    whatsappReady = false;
    console.log('⚠️ WhatsApp client disconnected:', reason);
    void logWhatsAppPageDiagnostics();
  });

  whatsappClient.on('change_state', (state: string) => {
    console.log('🔄 WhatsApp state:', state);
  });

  whatsappClient.on('loading_screen', (percent: number, message: string) => {
    console.log(`Loading: ${percent}% - ${message}`);
  });
}

export function isWhatsAppConnected(): boolean {
  return whatsappReady;
}

/**
 * Start the WhatsApp client.
 */
export async function startWhatsAppClient(): Promise<void> {
  console.log('🚀 Starting WhatsApp client...');
  let profileConflictCount = 0;

  while (true) {
    try {
      const initializePromise = whatsappClient.initialize();
      const initializeFailurePromise = initializePromise.then(
        () => new Promise<void>(() => undefined),
        (error: unknown) => Promise.reject(error),
      );

      void attachBrowserDiagnostics();

      await withTimeout(
        Promise.race([createReadyOrManualAttachPromise(), initializeFailurePromise]),
        START_TIMEOUT_MS,
      );
      return;
    } catch (error) {
      await logWhatsAppPageDiagnostics();
      await stopWhatsAppClient();

      if (!isExpectedBrowserProfileConflict(error, WHATSAPP_PROFILE_PATH)) {
        throw error;
      }

      profileConflictCount += 1;
      const recovery = await recoverBrowserProfile(WHATSAPP_PROFILE_PATH);
      const retryDelay = profileConflictRetryDelay(profileConflictCount, recovery);
      console.warn(
        `[WHATSAPP] Chrome profile conflict (${recovery}). Retrying in ${Math.round(retryDelay / 1000)} seconds without restarting TireFlow.`,
      );
      await wait(retryDelay);
    }
  }
}

/**
 * Stop the WhatsApp client and close the controlled browser.
 */
export async function stopWhatsAppClient(): Promise<void> {
  whatsappReady = false;
  const browserProcess = whatsappClient.pupBrowser?.process?.();
  let gracefulStopFailed = false;

  try {
    await withTimeout(whatsappClient.destroy(), SHUTDOWN_TIMEOUT_MS);
  } catch (error) {
    gracefulStopFailed = true;
    console.error('Could not stop WhatsApp client gracefully.', error);
  }

  if (browserProcess) {
    const exitedGracefully = await waitForBrowserProcessExit(browserProcess, BROWSER_EXIT_TIMEOUT_MS);

    if (!exitedGracefully) {
      console.warn('WhatsApp Chrome remained open after shutdown. Forcing its process to close.');
      try {
        if (!browserProcess.pid) throw new Error('Chrome process id is unavailable.');
        await forceStopBrowserProcessTree(browserProcess.pid);
      } catch (error) {
        console.error('Could not force the complete WhatsApp Chrome process tree to close.', error);
        browserProcess.kill('SIGKILL');
      }
      const exitedAfterForce = await waitForBrowserProcessExit(
        browserProcess,
        BROWSER_FORCE_EXIT_TIMEOUT_MS,
      );
      if (!exitedAfterForce) {
        throw new Error(`WhatsApp Chrome process ${browserProcess.pid ?? 'unknown'} did not exit.`);
      }
    }
  }

  if (gracefulStopFailed && !browserProcess) {
    console.warn('WhatsApp Chrome process was not available for forced shutdown.');
  }
}
