import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export interface PendingSaleResolutionSession {
  userId: string;
  chatId: string;
  step: 'awaiting_selection' | 'awaiting_status';
  pendingSaleIds: string[];
  selectedPendingSaleId?: string;
  updatedAt: number;
}

const sessions = new Map<string, PendingSaleResolutionSession>();

function key(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: PendingSaleResolutionSession): boolean {
  return Date.now() - session.updatedAt > EMPLOYEE_SESSION_TTL_MS;
}

export function savePendingSaleResolutionSession(
  session: PendingSaleResolutionSession
): void {
  sessions.set(key(session.userId, session.chatId), { ...session, updatedAt: Date.now() });
}

export function getPendingSaleResolutionSession(
  userId: string,
  chatId: string
): PendingSaleResolutionSession | null {
  const sessionKey = key(userId, chatId);
  const session = sessions.get(sessionKey);
  if (!session) return null;
  if (isExpired(session)) {
    sessions.delete(sessionKey);
    return null;
  }
  return { ...session, pendingSaleIds: [...session.pendingSaleIds] };
}

export function hasExpiredPendingSaleResolutionSession(
  userId: string,
  chatId: string
): boolean {
  const sessionKey = key(userId, chatId);
  const session = sessions.get(sessionKey);
  if (!session || !isExpired(session)) return false;
  sessions.delete(sessionKey);
  return true;
}

export function clearPendingSaleResolutionSession(userId: string, chatId: string): void {
  sessions.delete(key(userId, chatId));
}
