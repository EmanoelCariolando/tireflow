import { MessageMedia } from 'whatsapp-web.js';
import env from '../config/env.js';
import { whatsappClient } from '../whatsapp/client.js';

function getBossChatId(): string | null {
  const value = env.bossPrivateNumber.trim();

  if (!value) {
    return null;
  }

  if (value.includes('@')) {
    return value;
  }

  const digits = value.replace(/\D/g, '');
  return digits ? `${digits}@c.us` : null;
}

export async function sendBossNotification(text: string, media?: MessageMedia): Promise<void> {
  const bossChatId = getBossChatId();

  if (!bossChatId) {
    console.warn('BOSS_PRIVATE_NUMBER is not configured. Private boss notification was skipped.');
    return;
  }

  await whatsappClient.sendMessage(bossChatId, text);

  if (media) {
    await whatsappClient.sendMessage(bossChatId, media);
  }
}
