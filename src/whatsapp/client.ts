import whatsappWeb from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import type { ConsoleMessage, HTTPRequest, Page } from 'puppeteer';
import env from '../config/env.js';

const { Client, LocalAuth } = whatsappWeb;

const START_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 5000;
let diagnosticsAttached = false;

interface WhatsAppPageDiagnostics {
  url: string;
  title: string;
  readyState: string;
  visibleText: string;
  authStore: string;
  wwebjs: string;
  require: string;
}

interface WhatsAppClientInternals {
  attachEventListeners(): Promise<void>;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${milliseconds}ms`));
      }, milliseconds);
    }),
  ]);
}

function shorten(value: string, maxLength = 700): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
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
  if (diagnosticsAttached || !env.whatsappDebug) {
    return;
  }

  const page = await waitForPuppeteerPage();

  if (!page) {
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
    console.error(`[WA REQUEST FAILED] ${failure?.errorText || 'unknown'} ${shorten(request.url())}`);
  });
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

        return {
          url: globalThis.location.href,
          title: globalThis.document.title,
          readyState: globalThis.document.readyState,
          visibleText: globalThis.document.body?.innerText?.slice(0, 500) || '',
          authStore: hasValue('AuthStore'),
          wwebjs: hasValue('WWebJS'),
          require: typeof globalThis.require,
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
    diagnostics.require !== 'function'
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

    const finish = (): void => {
      if (recoveryTimeout) {
        clearTimeout(recoveryTimeout);
      }

      whatsappClient.removeListener('authenticated', onAuthenticated);
      whatsappClient.removeListener('ready', onReady);
      resolve();
    };

    const onReady = (): void => {
      finish();
    };

    const onAuthenticated = (): void => {
      recoveryTimeout = setTimeout(() => {
        attachMessageListenersManually()
          .then((attached) => {
            if (attached) {
              finish();
            }
          })
          .catch((error: unknown) => {
            reject(error);
          });
      }, 15_000);
    };

    whatsappClient.once('ready', onReady);
    whatsappClient.once('authenticated', onAuthenticated);
  });
}

/**
 * WhatsApp client instance.
 * Uses LocalAuth to persist session between restarts.
 * This avoids needing to scan the QR code every time.
 */
export const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: env.whatsappSessionName,
    dataPath: env.whatsappAuthDataPath,
  }),
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
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
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
    qrcode.generate(qr, { small: true });
    console.log('\nWaiting for authentication...\n');
  });

  // Client is ready to receive messages
  whatsappClient.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    console.log('🤖 TireFlow bot is now listening for messages.\n');
  });

  whatsappClient.on('authenticated', () => {
    console.log('✅ WhatsApp authentication successful.');
  });

  // Handle authentication failures
  whatsappClient.on('auth_failure', (msg: string) => {
    console.error('❌ Authentication failed:', msg);
  });

  // Handle disconnection
  whatsappClient.on('disconnected', (reason: string) => {
    console.log('⚠️ WhatsApp client disconnected:', reason);
  });

  whatsappClient.on('change_state', (state: string) => {
    console.log('🔄 WhatsApp state:', state);
  });

  whatsappClient.on('loading_screen', (percent: number, message: string) => {
    console.log(`Loading: ${percent}% - ${message}`);
  });
}

/**
 * Start the WhatsApp client.
 */
export async function startWhatsAppClient(): Promise<void> {
  console.log('🚀 Starting WhatsApp client...');
  console.log(`🔐 WhatsApp auth data path: ${env.whatsappAuthDataPath}`);
  console.log(`🧭 WhatsApp browser mode: ${env.whatsappHeadless ? 'headless' : 'visible'}`);
  console.log(`🧩 WhatsApp Web version: ${env.whatsappWebVersion || 'latest'}`);

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
  } catch (error) {
    await logWhatsAppPageDiagnostics();
    await stopWhatsAppClient();
    throw error;
  }
}

/**
 * Stop the WhatsApp client and close the controlled browser.
 */
export async function stopWhatsAppClient(): Promise<void> {
  const browserProcess = whatsappClient.pupBrowser?.process?.();

  try {
    await withTimeout(whatsappClient.destroy(), SHUTDOWN_TIMEOUT_MS);
  } catch (error) {
    console.error('Could not stop WhatsApp client gracefully. Forcing browser close.');

    if (browserProcess && !browserProcess.killed) {
      browserProcess.kill();
    }
  }

  await wait(1500);
}
