import { MessageMedia } from 'whatsapp-web.js';
import env from '../config/env.js';
import { whatsappClient } from '../whatsapp/client.js';

function normalizePhoneNumber(value: string): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  return digits || null;
}

function getPrivateChatId(phoneNumberConfig: string): string | null {
  const phoneNumber = normalizePhoneNumber(phoneNumberConfig.trim());

  if (!phoneNumber) {
    return null;
  }

  return `${phoneNumber}@c.us`;
}

export async function sendBossNotification(text: string, media?: MessageMedia): Promise<void> {
  await sendBossTextNotification(text);

  if (media) {
    await sendBossMediaNotification(media);
  }
}

export async function sendBossTextNotification(text: string): Promise<void> {
  const bossChatId = getPrivateChatId(env.bossPrivateNumber);

  if (!bossChatId) {
    console.warn('BOSS_PRIVATE_NUMBER is not configured. Private boss notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(bossChatId, text);
}

export async function sendBossMediaNotification(media: MessageMedia): Promise<void> {
  const bossChatId = getPrivateChatId(env.bossPrivateNumber);

  if (!bossChatId) {
    console.warn('BOSS_PRIVATE_NUMBER is not configured. Private boss media notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(bossChatId, media);
}

export async function sendOwnerNotification(text: string): Promise<void> {
  const ownerChatId = getPrivateChatId(env.ownerPhone);

  if (!ownerChatId) {
    console.warn('OWNER_PHONE is not configured. Daily report notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(ownerChatId, text);
}
