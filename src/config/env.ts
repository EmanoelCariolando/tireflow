import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ quiet: true });

export const DEFAULT_BRANCH_NAME = 'ATC PNEUS';

export interface EnvConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  branchName: string;
  whatsappSessionName: string;
  whatsappAuthDataPath: string;
  whatsappDebug: boolean;
  whatsappHeadless: boolean;
  chromeExecutablePath: string;
  whatsappWebVersion: string;
  whatsappOfficialGroupId: string;
  bossPrivateNumber: string;
  ownerPhone: string;
  dailyReportTime: string;
  allowPrivateTestMode: boolean;
  backupRetention: number;
  logMaxBytes: number;
  logRetentionDays: number;
  logToConsole: boolean;
  healthLogIntervalMinutes: number;
}

const BOOLEAN_VALUES = new Set(['true', 'false']);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isValidPhone(value: string): boolean {
  return /^\d{10,15}(?:@c\.us)?$/.test(value.replace(/[\s()+-]/g, ''));
}

function isValidDailyTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

/** Returns configuration errors without ever including configured values. */
export function validateEnvironment(source: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  const requiredVariables = [
    'NODE_ENV',
    'DATABASE_URL',
    'BRANCH_NAME',
    'WHATSAPP_OFFICIAL_GROUP_ID',
    'BOSS_PRIVATE_NUMBER',
    'OWNER_PHONE',
    'DAILY_REPORT_TIME',
  ] as const;

  for (const variableName of requiredVariables) {
    if (!source[variableName]?.trim()) {
      errors.push(`${variableName}: variável obrigatória ausente ou vazia`);
    }
  }

  const nodeEnv = source.NODE_ENV?.trim().toLowerCase() || '';
  if (nodeEnv && !['development', 'test', 'production'].includes(nodeEnv)) {
    errors.push('NODE_ENV: use development, test ou production');
  }

  const branchName = source.BRANCH_NAME?.trim() || '';
  if (branchName && (branchName.length > 80 || /[\r\n\0]/.test(branchName))) {
    errors.push('BRANCH_NAME: use uma única linha com no máximo 80 caracteres');
  }

  const groupId = source.WHATSAPP_OFFICIAL_GROUP_ID?.trim() || '';
  if (groupId && !/^\d+@g\.us$/.test(groupId)) {
    errors.push('WHATSAPP_OFFICIAL_GROUP_ID: formato inválido; esperado número@g.us');
  }

  for (const phoneVariable of ['BOSS_PRIVATE_NUMBER', 'OWNER_PHONE'] as const) {
    const phone = source[phoneVariable]?.trim() || '';
    if (phone && !isValidPhone(phone)) {
      errors.push(`${phoneVariable}: formato inválido; use somente DDI, DDD e número`);
    }
  }

  const reportTime = source.DAILY_REPORT_TIME?.trim() || '';
  if (reportTime && !isValidDailyTime(reportTime)) {
    errors.push('DAILY_REPORT_TIME: horário inválido; use HH:mm');
  }

  for (const booleanVariable of [
    'WHATSAPP_DEBUG',
    'WHATSAPP_HEADLESS',
    'ALLOW_PRIVATE_TEST_MODE',
    'LOG_TO_CONSOLE',
  ] as const) {
    const value = source[booleanVariable]?.trim().toLowerCase();
    if (value && !BOOLEAN_VALUES.has(value)) {
      errors.push(`${booleanVariable}: use true ou false`);
    }
  }

  if (source.DATABASE_URL?.trim() && !source.DATABASE_URL.trim().startsWith('file:')) {
    errors.push('DATABASE_URL: esta instalação requer uma URL SQLite iniciada por file:');
  }

  for (const integerVariable of [
    'BACKUP_RETENTION',
    'LOG_MAX_BYTES',
    'LOG_RETENTION_DAYS',
    'HEALTH_LOG_INTERVAL_MINUTES',
  ] as const) {
    const value = source[integerVariable]?.trim();
    if (value && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) {
      errors.push(`${integerVariable}: use um número inteiro maior que zero`);
    }
  }

  return errors;
}

export function assertRuntimeEnvironment(source: NodeJS.ProcessEnv = process.env): void {
  const errors = validateEnvironment(source);
  if (errors.length === 0) {
    return;
  }

  throw new Error(
    ['Configuração do TireFlow inválida:', ...errors.map((error) => `- ${error}`)].join('\n')
  );
}

/**
 * Validated environment configuration.
 * All required values are loaded here with sensible defaults.
 */
export const env: EnvConfig = {
  nodeEnv: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
    ? process.env.NODE_ENV
    : 'development',
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
  branchName: process.env.BRANCH_NAME?.trim() || DEFAULT_BRANCH_NAME,
  whatsappSessionName: process.env.WHATSAPP_SESSION_NAME || 'tireflow-session',
  whatsappAuthDataPath:
    process.env.WHATSAPP_AUTH_DATA_PATH ||
    `${process.env.LOCALAPPDATA || process.cwd()}\\TireFlow\\wwebjs_auth`,
  whatsappDebug: process.env.WHATSAPP_DEBUG === 'true',
  whatsappHeadless: process.env.WHATSAPP_HEADLESS !== 'false',
  chromeExecutablePath:
    process.env.CHROME_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  whatsappWebVersion: process.env.WHATSAPP_WEB_VERSION || '',
  whatsappOfficialGroupId: process.env.WHATSAPP_OFFICIAL_GROUP_ID || '',
  bossPrivateNumber: process.env.BOSS_PRIVATE_NUMBER || '',
  ownerPhone: process.env.OWNER_PHONE || '',
  dailyReportTime: process.env.DAILY_REPORT_TIME || '',
  allowPrivateTestMode: process.env.ALLOW_PRIVATE_TEST_MODE === 'true',
  backupRetention: parsePositiveInteger(process.env.BACKUP_RETENTION, 14),
  logMaxBytes: parsePositiveInteger(process.env.LOG_MAX_BYTES, 10 * 1024 * 1024),
  logRetentionDays: parsePositiveInteger(process.env.LOG_RETENTION_DAYS, 30),
  logToConsole: process.env.LOG_TO_CONSOLE !== 'false',
  healthLogIntervalMinutes: parsePositiveInteger(process.env.HEALTH_LOG_INTERVAL_MINUTES, 15),
};

export default env;
