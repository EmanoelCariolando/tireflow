import { Message, MessageMedia } from 'whatsapp-web.js';
import env from '../config/env.js';
import { whatsappClient } from '../whatsapp/client.js';

const privateChatIdCache = new Map<string, string>();

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
    contactId = await whatsappClient.getNumberId(phoneNumber);
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

  await sendPrivateMessage(bossChatId, text, 'boss text notification');
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
      console.log(`[NOTIFICATION] Forwarding receipt using live message reference: ${messageId}`);
      await fallbackMessage.forward(bossChatId);
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
    message = await whatsappClient.getMessageById(messageId);
  } catch (error) {
    console.warn('[NOTIFICATION] Could not recover message by id for forwarding.', {
      messageId,
      error,
    });
  }

  if (!message) {
    throw new Error(`Could not recover receipt message by id: ${messageId}`);
  }

  await message.forward(bossChatId);
}

export async function sendOwnerNotification(text: string): Promise<void> {
  const ownerChatId = await getPrivateChatId(env.ownerPhone);

  if (!ownerChatId) {
    console.warn('OWNER_PHONE is not configured. Daily report notification was skipped.');
    return;
  }

  await sendPrivateMessage(ownerChatId, text, 'owner daily report notification');
}

async function sendPrivateMessage(
  chatId: string,
  content: string | MessageMedia,
  label: string
): Promise<void> {
  try {
    await whatsappClient.sendMessage(chatId, content);
  } catch (error) {
    console.error(`[NOTIFICATION] Error sending ${label}.`, {
      chatId,
      error,
    });
    throw error;
  }
}
