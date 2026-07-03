import { Message } from 'whatsapp-web.js';

/**
 * Retorna o identificador do usuário que executou o comando.
 * Em grupos, o WhatsApp informa o autor em `message.author`.
 */
export function getMessageUserId(message: Message): string {
  return message.author || message.from;
}

/**
 * Retorna o identificador da conversa onde a mensagem foi enviada.
 */
export function getMessageChatId(message: Message): string {
  return message.from;
}

export function isGroupMessage(message: Message): boolean {
  return message.from.includes('@g.us');
}
