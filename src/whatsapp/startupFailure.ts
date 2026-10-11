export interface StartupPageState {
  url: string;
  title: string;
  readyState: string;
  authStore: string;
  wwebjs: string;
  require: string;
}

export function isStartupErrorPage(page: StartupPageState | undefined): boolean {
  if (!page || page.readyState !== 'complete') return false;
  if (page.url.startsWith('chrome-error://')) return true;
  return /^https:\/\/web\.whatsapp\.com\//.test(page.url)
    && /^(error|erro)$/i.test(page.title.trim())
    && page.authStore === 'undefined'
    && page.wwebjs === 'undefined'
    && page.require === 'undefined';
}

export class WhatsAppStartupPageError extends Error {
  constructor() {
    super('WhatsApp Web opened an error page during startup.');
    this.name = 'WhatsAppStartupPageError';
  }
}

export function isRetryableStartupFailure(error: unknown): boolean {
  if (error instanceof WhatsAppStartupPageError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|NETWORK_CHANGED|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED)\b/.test(message);
}

export function startupNetworkRetryDelay(attempt: number): number {
  return Math.min(15_000 * 2 ** Math.min(Math.max(0, attempt - 1), 3), 120_000);
}
