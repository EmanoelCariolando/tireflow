export type AddPhotoSessionStep = 'awaiting_image';

export interface AddPhotoSession {
  userId: string;
  chatId: string;
  step: AddPhotoSessionStep;
  productId: string;
  itemNumber: number;
  description: string;
  startedAt: number;
}

const addPhotoSessions = new Map<string, AddPhotoSession>();
export const ADD_PHOTO_SESSION_TTL_MS = 5 * 60 * 1000;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: AddPhotoSession): boolean {
  return Date.now() - session.startedAt > ADD_PHOTO_SESSION_TTL_MS;
}

export function saveAddPhotoSession(session: AddPhotoSession): void {
  addPhotoSessions.set(buildKey(session.userId, session.chatId), { ...session });
}

export function getAddPhotoSession(userId: string, chatId: string): AddPhotoSession | null {
  const key = buildKey(userId, chatId);
  const session = addPhotoSessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    addPhotoSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredAddPhotoSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = addPhotoSessions.get(key);

  if (!session || !isExpired(session)) {
    return false;
  }

  addPhotoSessions.delete(key);
  return true;
}

export function clearAddPhotoSession(userId: string, chatId: string): void {
  addPhotoSessions.delete(buildKey(userId, chatId));
}
