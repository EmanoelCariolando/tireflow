import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

interface EnvConfig {
  whatsappSessionName: string;
  whatsappDebug: boolean;
}

/**
 * Validated environment configuration.
 * All required values are loaded here with sensible defaults.
 */
export const env: EnvConfig = {
  whatsappSessionName: process.env.WHATSAPP_SESSION_NAME || 'tireflow-session',
  whatsappDebug: process.env.WHATSAPP_DEBUG === 'true',
};

// Basic validation (can be expanded in future phases)
if (!env.whatsappSessionName) {
  throw new Error('WHATSAPP_SESSION_NAME is required');
}

export default env;
