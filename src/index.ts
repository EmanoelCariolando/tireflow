import { whatsappClient, initializeWhatsAppClient, startWhatsAppClient, stopWhatsAppClient } from './whatsapp/client.js';
import { handleIncomingMessage } from './whatsapp/messageHandler.js';
import { startDailyReportScheduler, stopDailyReportScheduler } from './services/dailyReportScheduler.js';
import { warmUpNotificationTargets } from './services/notificationService.js';
import env from './config/env.js';
import { disconnectPrisma } from './database/prisma.js';
import { installStructuredLogging } from './services/logger.js';
import { runStartupChecks } from './services/startupService.js';
import { startHealthMonitor, stopHealthMonitor } from './services/healthService.js';

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
  installStructuredLogging();
  console.log('========================================');
  console.log('   TireFlow - WhatsApp Bot (MVP)');
  console.log('========================================\n');

  try {
    // 1. Refuse to start with an incomplete installation.
    await runStartupChecks();

    // 2. Initialize WhatsApp client (sets up event listeners)
    initializeWhatsAppClient();

    // 3. Register message handler with a rejection boundary.
    whatsappClient.on('message', (message) => {
      void handleIncomingMessage(message).catch((error: unknown) => {
        console.error('[MESSAGE] Unhandled command error.', error);
      });
    });

    whatsappClient.on('disconnected', (reason: string) => {
      if (env.nodeEnv !== 'production' || isShuttingDown) return;
      console.error('[WHATSAPP] Disconnected in production; exiting for service restart.', { reason });
      setTimeout(() => void shutdown('WHATSAPP_DISCONNECTED', 1), 2000);
    });

    // 4. Start the client (this will show QR code if needed)
    await startWhatsAppClient();

    // 5. Resolve private notification chats before the first sale/report needs them
    await warmUpNotificationTargets();

    // 6. Start daily report scheduler
    startDailyReportScheduler();
    startHealthMonitor();

    console.log('Bot is running. Press Ctrl+C to stop.\n');
  } catch (error) {
    console.error('Failed to start TireFlow:', error);
    process.exit(1);
  }
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\nShutting down TireFlow (${signal})...`);

  try {
    stopDailyReportScheduler();
    stopHealthMonitor();
    await stopWhatsAppClient();
  } catch (error) {
    console.error('Error while stopping WhatsApp client:', error);
  } finally {
    await disconnectPrisma().catch((error: unknown) => {
      console.error('[DATABASE] Error disconnecting Prisma.', error);
    });
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (error: unknown) => {
  console.error('[PROCESS] Unhandled promise rejection.', error);
  void shutdown('UNHANDLED_REJECTION', 1);
});

process.on('uncaughtException', (error: Error) => {
  console.error('[PROCESS] Uncaught exception.', error);
  void shutdown('UNCAUGHT_EXCEPTION', 1);
});

// Start the application
void main();
