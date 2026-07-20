import { Message } from 'whatsapp-web.js';
import { isGroupMessage } from '../utils/messageContext.js';

const GROUP_ID_COMMAND = 'grupo id';

export function isGroupIdCommand(body: string): boolean {
  return body.trim().toLowerCase() === GROUP_ID_COMMAND;
}

export async function handleGroupIdCommand(message: Message): Promise<void> {
  if (!isGroupMessage(message)) {
    return;
  }

  await message.reply(`ID deste grupo:\n${message.from}`);
  console.log('[GROUP_ID] Group id requested in a WhatsApp group.');
}
