import { disconnectPrisma } from './database/prisma.js';
import { installStructuredLogging } from './services/logger.js';
import { runStartupChecks } from './services/startupService.js';

installStructuredLogging();

runStartupChecks()
  .then(() => console.log('[RUNTIME_CHECK] Instalação pronta para iniciar o WhatsApp.'))
  .catch((error: unknown) => {
    console.error('[RUNTIME_CHECK] Instalação inválida.', error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
