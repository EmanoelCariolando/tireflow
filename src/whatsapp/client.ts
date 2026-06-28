import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import env from '../config/env.js';

/**
 * WhatsApp client instance.
 * Uses LocalAuth to persist session between restarts.
 * This avoids needing to scan the QR code every time.
 */
export const whatsappClient = new Client({
  authStrategy: new LocalAuth({
    clientId: env.whatsappSessionName,
  }),
  puppeteer: {
    headless: true,
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

  // Handle authentication failures
  whatsappClient.on('auth_failure', (msg: string) => {
    console.error('❌ Authentication failed:', msg);
  });

  // Handle disconnection
  whatsappClient.on('disconnected', (reason: string) => {
    console.log('⚠️ WhatsApp client disconnected:', reason);
  });

  // Optional: log when loading screen changes (useful for debugging)
  if (env.whatsappDebug) {
    whatsappClient.on('loading_screen', (percent: number, message: string) => {
      console.log(`Loading: ${percent}% - ${message}`);
    });
  }
}

/**
 * Start the WhatsApp client.
 */
export async function startWhatsAppClient(): Promise<void> {
  console.log('🚀 Starting WhatsApp client...');
  await whatsappClient.initialize();
}
