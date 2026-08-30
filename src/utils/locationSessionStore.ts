import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export type LocationSessionStep =
  | 'awaiting_location'
  | 'awaiting_confirmation'
  | 'processing';

export interface LocationSession {
  userId: string;
  chatId: string;
  step: LocationSessionStep;
  productId: string;
  reference: string;
  description: string;
  previousLocation: string | null;
  newLocation?: string;
  updatedAt: number;
}

const locationSessions = new Map<string, LocationSession>();
const TTL_MS = EMPLOYEE_SESSION_TTL_MS;

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: LocationSession): boolean {
  return Date.now() - session.updatedAt > TTL_MS;
}

export function saveLocationSession(session: LocationSession): void {
  locationSessions.set(buildKey(session.userId, session.chatId), {
    ...session,
    updatedAt: Date.now(),
  });
}

export function getLocationSession(userId: string, chatId: string): LocationSession | null {
  const key = buildKey(userId, chatId);
  const session = locationSessions.get(key);

  if (!session) {
    return null;
  }

  if (isExpired(session)) {
    locationSessions.delete(key);
    return null;
  }

  return { ...session };
}

export function hasExpiredLocationSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = locationSessions.get(key);

  if (!session || !isExpired(session)) {
    return false;
  }

  locationSessions.delete(key);
  return true;
}

export function clearLocationSession(userId: string, chatId: string): void {
  locationSessions.delete(buildKey(userId, chatId));
}
