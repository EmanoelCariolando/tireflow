import { whatsappClient, initializeWhatsAppClient, startWhatsAppClient } from './whatsapp/client.js';
import { handleIncomingMessage } from './whatsapp/messageHandler.js';

/**
 * TireFlow - Main Entry Point (Fase 1)
 * 
 * This is the ONLY file that should be executed directly.
 * 
 * Responsibilities in Phase 1:
 * - Load environment configuration
 * - Initialize WhatsApp client
 * - Set up message listener
 * - Start the bot
 * 
 * Rules followed:
 * - No business logic here
 * - No commands implemented except ping
 * - Clean separation of concerns
 */
async function main(): Promise<void> {
  console.log('========================================');
  console.log('   TireFlow - WhatsApp Bot (Fase 1)');
  console.log('========================================\n');

  try {
    // 1. Initialize WhatsApp client (sets up event listeners)
    initializeWhatsAppClient();

    // 2. Register message handler
    whatsappClient.on('message', handleIncomingMessage);

    // 3. Start the client (this will show QR code if needed)
    await startWhatsAppClient();

    console.log('Bot is running. Press Ctrl+C to stop.\n');
  } catch (error) {
    console.error('Failed to start TireFlow:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n Shutting down TireFlow...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n Shutting down TireFlow...');
  process.exit(0);
});

// Start the application
main();
