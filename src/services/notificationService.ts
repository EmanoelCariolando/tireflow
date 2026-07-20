import { Message, MessageMedia } from 'whatsapp-web.js';
import env, { DEFAULT_BRANCH_NAME } from '../config/env.js';
import { whatsappClient } from '../whatsapp/client.js';

const privateChatIdCache = new Map<string, string>();
let privateSendQueue: Promise<void> = Promise.resolve();
const PRIVATE_SEND_ATTEMPTS = 2;
const PRIVATE_OPERATION_TIMEOUT_MS = 20_000;

function withTimeout<T>(operation: Promise<T>, milliseconds = PRIVATE_OPERATION_TIMEOUT_MS): Promise<T> {
  let timeout: NodeJS.Timeout;
  const result = Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Private WhatsApp operation timed out after ${milliseconds}ms.`)),
        milliseconds
      );
    }),
  ]);
  return result.finally(() => clearTimeout(timeout));
}

/**
 * Adds the installation branch to a private owner notification.
 * Group messages must not use this formatter.
 */
export function formatPrivateOwnerNotification(
  text: string,
  branchName = env.branchName
): string {
  const normalizedBranchName = branchName.trim() || DEFAULT_BRANCH_NAME;
  const header = `🏢 ${normalizedBranchName}`;

  if (text === header || text.startsWith(`${header}\n`)) {
    return text;
  }

  return `${header}\n\n${text}`;
}

function normalizePhoneNumber(value: string): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  return digits || null;
}

async function getPrivateChatId(phoneNumberConfig: string): Promise<string | null> {
  const phoneNumber = normalizePhoneNumber(phoneNumberConfig.trim());

  if (!phoneNumber) {
    return null;
  }

  const cachedChatId = privateChatIdCache.get(phoneNumber);

  if (cachedChatId) {
    return cachedChatId;
  }

  let contactId: Awaited<ReturnType<typeof whatsappClient.getNumberId>>;

  try {
    contactId = await withTimeout(whatsappClient.getNumberId(phoneNumber));
  } catch (error) {
    console.warn('[NOTIFICATION] Could not resolve private WhatsApp number.', {
      phoneNumber,
      error,
    });
    return null;
  }

  if (!contactId) {
    return null;
  }

  privateChatIdCache.set(phoneNumber, contactId._serialized);
  return contactId._serialized;
}

export function hasBossNotificationTarget(): boolean {
  return Boolean(normalizePhoneNumber(env.bossPrivateNumber.trim()));
}

export async function getBossChatId(): Promise<string | null> {
  const bossChatId = await getPrivateChatId(env.bossPrivateNumber);

  if (!bossChatId) {
    console.warn('BOSS_PRIVATE_NUMBER is not configured or is not registered on WhatsApp.');
  }

  return bossChatId;
}

export async function warmUpNotificationTargets(): Promise<void> {
  const warmUpTasks: Promise<string | null>[] = [];

  if (hasBossNotificationTarget()) {
    warmUpTasks.push(getPrivateChatId(env.bossPrivateNumber));
  }

  if (normalizePhoneNumber(env.ownerPhone.trim())) {
    warmUpTasks.push(getPrivateChatId(env.ownerPhone));
  }

  if (warmUpTasks.length === 0) {
    return;
  }

  const startedAt = Date.now();
  const results = await Promise.allSettled(warmUpTasks);
  const resolvedCount = results.filter(
    (result) => result.status === 'fulfilled' && Boolean(result.value)
  ).length;

  console.log(
    `[NOTIFICATION] Private notification targets warmed up (${resolvedCount}/${warmUpTasks.length}) in ${
      Date.now() - startedAt
    }ms.`
  );
}

export async function sendBossNotification(text: string, media?: MessageMedia): Promise<void> {
  await sendBossTextNotification(text);

  if (media) {
    await sendBossMediaNotification(media);
  }
}

export async function sendBossTextNotification(text: string): Promise<void> {
  const bossChatId = await getBossChatId();

  if (!bossChatId) {
    console.warn('Private boss notification was skipped.');
    return;
  }

  await sendPrivateOwnerTextMessage(bossChatId, text, 'boss text notification');
}

export async function sendBossMediaNotification(media: MessageMedia): Promise<void> {
  const bossChatId = await getBossChatId();

  if (!bossChatId) {
    console.warn('Private boss media notification was skipped.');
    return;
  }

  await sendPrivateMessage(bossChatId, media, 'boss media notification');
}

export async function forwardMessageToBoss(messageId: string, fallbackMessage?: Message): Promise<void> {
  const bossChatId = await getBossChatId();

  if (!bossChatId) {
    console.warn('Private boss media forward was skipped.');
    return;
  }

  if (fallbackMessage) {
    try {
      console.log('[NOTIFICATION] Forwarding receipt using live message reference.');
      await withTimeout(fallbackMessage.forward(bossChatId));
      return;
    } catch (error) {
      console.warn('[NOTIFICATION] Live message forward failed. Trying to recover by id.', {
        messageId,
        error,
      });
    }
  }

  let message: Message | null = null;

  try {
    message = await withTimeout(whatsappClient.getMessageById(messageId));
  } catch (error) {
    console.warn('[NOTIFICATION] Could not recover message by id for forwarding.', {
      messageId,
      error,
    });
  }

  if (!message) {
    throw new Error(`Could not recover receipt message by id: ${messageId}`);
  }

  await withTimeout(message.forward(bossChatId));
}

export async function sendOwnerNotification(text: string): Promise<void> {
  const ownerChatId = await getPrivateChatId(env.ownerPhone);

  if (!ownerChatId) {
    console.warn('OWNER_PHONE is not configured. Daily report notification was skipped.');
    return;
  }

  await sendPrivateOwnerTextMessage(ownerChatId, text, 'owner notification');
}

async function sendPrivateOwnerTextMessage(
  chatId: string,
  text: string,
  label: string
): Promise<void> {
  await sendPrivateMessage(chatId, formatPrivateOwnerNotification(text), label);
}

async function sendPrivateMessage(
  chatId: string,
  content: string | MessageMedia,
  label: string
): Promise<void> {
  const queuedSend = privateSendQueue.then(
    () => sendPrivateMessageWithRetry(chatId, content, label),
    () => sendPrivateMessageWithRetry(chatId, content, label)
  );
  privateSendQueue = queuedSend.then(() => undefined, () => undefined);
  return queuedSend;
}

async function sendPrivateMessageWithRetry(
  chatId: string,
  content: string | MessageMedia,
  label: string
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PRIVATE_SEND_ATTEMPTS; attempt++) {
    try {
      await withTimeout(whatsappClient.sendMessage(chatId, content));
      return;
    } catch (error) {
      lastError = error;
      console.warn(`[NOTIFICATION] ${label} attempt ${attempt}/${PRIVATE_SEND_ATTEMPTS} failed.`, {
        chatId,
        error,
      });
      if (attempt < PRIVATE_SEND_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  console.error(`[NOTIFICATION] ${label} exhausted all retry attempts.`, {
    chatId,
    error: lastError,
  });
  throw lastError;
}
