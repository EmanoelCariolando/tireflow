export type EntrySessionStep =
  | 'awaiting_quantity'
  | 'awaiting_supplier'
  | 'awaiting_confirmation'
  | 'processing';

export interface EntrySession {
  userId: string;
  chatId: string;
  step: EntrySessionStep;
  productId: string;
  reference: string;
  description: string;
  quantity?: number;
  supplier?: string;
  updatedAt: number;
}

const entrySessions = new Map<string, EntrySession>();
const TTL_MS = 5 * 60 * 1000;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: EntrySession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function saveEntrySession(session: EntrySession): void {
  entrySessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getEntrySession(userId: string, chatId: string): EntrySession | null {
  const key = buildKey(userId, chatId);
  const session = entrySessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    entrySessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredEntrySession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = entrySessions.get(key);

  if (!session) {
    return false;
  }

  if (!isExpired(session)) {
    return false;
  }

  entrySessions.delete(key);
  return true;
}

export function clearEntrySession(userId: string, chatId: string): void {
  entrySessions.delete(buildKey(userId, chatId));
}
