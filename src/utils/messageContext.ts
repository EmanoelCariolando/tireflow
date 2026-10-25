import type { Message } from 'whatsapp-web.js';

export function isIndividualChatId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+@(c\.us|lid)$/.test(value);
}

export function isGroupChatId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:-\d+)?@g\.us$/.test(value);
}

/** Recover the SDK's derived ID using the same format previously used for receipts. */
export function getSerializedMessageId(message: Message): string | null {
  const id = message.id as {
    fromMe?: boolean; remote?: string; id?: string; _serialized?: string;
    participant?: string | { _serialized?: string; user?: string };
  } | undefined;
  if (id?._serialized != null && typeof id._serialized !== 'string') return null;
  if (id?._serialized) return id._serialized;
  if (typeof id?.fromMe !== 'boolean' || typeof id.remote !== 'string' || !id.remote ||
      typeof id.id !== 'string' || !id.id) return null;

  const participant = (typeof id.participant === 'string'
    ? id.participant : id.participant?._serialized || id.participant?.user) || message.author;
  const serialized = participant && isGroupChatId(id.remote)
    ? `${id.fromMe}_${id.remote}_${id.id}_${participant}`
    : `${id.fromMe}_${id.remote}_${id.id}`;
  id._serialized = serialized;
  return serialized;
}

/** Validate the SDK envelope; identifier syntax alone does not authenticate a sender. */
export function hasValidMessageIdentity(message: Message): boolean {
  if (message.fromMe !== false || message.id?.fromMe !== false || message.isStatus === true || message.broadcast === true) return false;
  if (typeof message.id.id !== 'string' || !message.id.id.trim() ||
      typeof message.id._serialized !== 'string' || !message.id._serialized.trim() ||
      message.id.remote !== message.from) return false;

  if (isGroupChatId(message.from)) return isIndividualChatId(message.author);
  return isIndividualChatId(message.from) &&
    (message.author == null || message.author === message.from);
}

/**
 * Retorna o identificador do usuário que executou o comando.
 * Em grupos, o WhatsApp informa o autor em `message.author`.
 */
export function getMessageUserId(message: Message): string {
  return message.author || (isGroupMessage(message) ? '' : message.from);
}

/**
 * Retorna o identificador da conversa onde a mensagem foi enviada.
 */
export function getMessageChatId(message: Message): string {
  return message.from;
}

export function isGroupMessage(message: Message): boolean {
  return typeof message.from === 'string' && message.from.endsWith('@g.us');
}
