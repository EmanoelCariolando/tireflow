import { MessageMedia } from 'whatsapp-web.js';
import env from '../config/env.js';
import { whatsappClient } from '../whatsapp/client.js';

function getBossPhoneNumber(): string | null {
  const value = env.bossPrivateNumber.trim();

  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  return digits || null;
}

async function getBossChatId(): Promise<string | null> {
  const phoneNumber = getBossPhoneNumber();

  if (!phoneNumber) {
    return null;
  }

  const contactId = await whatsappClient.getNumberId(phoneNumber);

  if (!contactId) {
    console.warn(`BOSS_PRIVATE_NUMBER is not registered on WhatsApp: ${phoneNumber}`);
    return null;
  }

  return contactId._serialized;
}

export async function sendBossNotification(text: string, media?: MessageMedia): Promise<void> {
  const bossChatId = await getBossChatId();

  if (!bossChatId) {
    console.warn('BOSS_PRIVATE_NUMBER is not configured. Private boss notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(bossChatId, text);

  if (media) {
    await whatsappClient.sendMessage(bossChatId, media);
  }
}
