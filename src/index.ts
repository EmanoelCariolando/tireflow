import { whatsappClient, initializeWhatsAppClient, startWhatsAppClient, stopWhatsAppClient } from './whatsapp/client.js';
import { handleIncomingMessage } from './whatsapp/messageHandler.js';
import { startDailyReportScheduler, stopDailyReportScheduler } from './services/dailyReportScheduler.js';

let isShuttingDown = false;

/**
 * TireFlow - Main Entry Point (Fase 3)
 * 
 * This is the ONLY file that should be executed directly.
 * 
 * Responsibilities:
 * - Load environment configuration
 * - Initialize WhatsApp client
 * - Set up message listener
 * - Start the bot
 * 
 * Rules followed:
 * - No business logic here
 * - Clean separation of concerns
 */
async function main(): Promise<void> {
  console.log('========================================');
  console.log('   TireFlow - WhatsApp Bot (MVP)');
  console.log('========================================\n');

  try {
    // 1. Initialize WhatsApp client (sets up event listeners)
    initializeWhatsAppClient();

    // 2. Register message handler
    whatsappClient.on('message', handleIncomingMessage);

    // 3. Start the client (this will show QR code if needed)
    await startWhatsAppClient();

    // 4. Start daily report scheduler
    startDailyReportScheduler();

    console.log('Bot is running. Press Ctrl+C to stop.\n');
  } catch (error) {
    console.error('Failed to start TireFlow:', error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\nShutting down TireFlow (${signal})...`);

  try {
    stopDailyReportScheduler();
    await stopWhatsAppClient();
  } catch (error) {
    console.error('Error while stopping WhatsApp client:', error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

// Start the application
void main();
