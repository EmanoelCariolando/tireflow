import type { Message } from 'whatsapp-web.js';

const MESSAGE_TTL_MS = 10 * 60 * 1000;
const MAX_TRACKED_MESSAGES = 5000;
const processedMessages = new Map<string, number>();

function getMessageId(message: Message): string | null {
  const id = message.id as { _serialized?: string } | undefined;
  return id?._serialized || null;
}

function pruneExpiredMessages(now: number): void {
  for (const [messageId, expiresAt] of processedMessages) {
    if (expiresAt <= now || processedMessages.size > MAX_TRACKED_MESSAGES) {
      processedMessages.delete(messageId);
    }
  }
}

/** Marks a WhatsApp event before routing it. Returns false for a repeated event. */
export function markMessageForProcessing(message: Message, now = Date.now()): boolean {
  const messageId = getMessageId(message);
  if (!messageId) return true;

  const existingExpiration = processedMessages.get(messageId);
  if (existingExpiration && existingExpiration > now) return false;

  processedMessages.set(messageId, now + MESSAGE_TTL_MS);
  if (processedMessages.size > MAX_TRACKED_MESSAGES) pruneExpiredMessages(now);
  return true;
}

export function clearProcessedMessages(): void {
  processedMessages.clear();
}
