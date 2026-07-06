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

async function getPrivateChatId(phoneNumberConfig: string, label: string): Promise<string | null> {
  const phoneNumber = normalizePhoneNumber(phoneNumberConfig.trim());

  if (!phoneNumber) {
    return null;
  }

  const contactId = await whatsappClient.getNumberId(phoneNumber);

  if (!contactId) {
    console.warn(`${label} is not registered on WhatsApp: ${phoneNumber}`);
    return null;
  }

  return contactId._serialized;
}

export async function sendBossNotification(text: string, media?: MessageMedia): Promise<void> {
  const bossChatId = await getPrivateChatId(env.bossPrivateNumber, 'BOSS_PRIVATE_NUMBER');

  if (!bossChatId) {
    console.warn('BOSS_PRIVATE_NUMBER is not configured. Private boss notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(bossChatId, text);

  if (media) {
    await whatsappClient.sendMessage(bossChatId, media);
  }
}

export async function sendOwnerNotification(text: string): Promise<void> {
  const ownerChatId = await getPrivateChatId(env.ownerPhone, 'OWNER_PHONE');

  if (!ownerChatId) {
    console.warn('OWNER_PHONE is not configured. Daily report notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(ownerChatId, text);
}
