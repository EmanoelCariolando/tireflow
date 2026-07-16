import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

interface EnvConfig {
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
}

/**
 * Validated environment configuration.
 * All required values are loaded here with sensible defaults.
 */
export const env: EnvConfig = {
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
};

// Basic validation (can be expanded in future phases)
if (!env.whatsappSessionName) {
  throw new Error('WHATSAPP_SESSION_NAME is required');
}

export default env;
