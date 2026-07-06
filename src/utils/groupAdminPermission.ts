import { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import { getMessageUserId, isGroupMessage } from './messageContext.js';

interface GroupParticipantId {
  _serialized?: string;
  user?: string;
}

interface GroupParticipant {
  id?: GroupParticipantId;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

interface GroupChatLike {
  participants?: GroupParticipant[];
}

function getUserPart(id: string): string {
  return id.split('@')[0];
}

function isSameParticipant(participantId: GroupParticipantId | undefined, userId: string): boolean {
  const serialized = participantId?._serialized;
  const user = participantId?.user;

  if (serialized === userId) {
    return true;
  }

  if (serialized && getUserPart(serialized) === getUserPart(userId)) {
    return true;
  }

  return Boolean(user && user === getUserPart(userId));
}

export async function isMessageFromGroupAdmin(message: Message): Promise<boolean> {
  if (!isGroupMessage(message)) {
    return env.allowPrivateTestMode;
  }

  const chat = (await message.getChat()) as unknown as GroupChatLike;
  const authorId = getMessageUserId(message);

  return Boolean(
    chat.participants?.some((participant) => {
      const isAdmin = Boolean(participant.isAdmin || participant.isSuperAdmin);
      return isAdmin && isSameParticipant(participant.id, authorId);
    })
  );
}
