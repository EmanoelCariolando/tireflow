const MENU_SESSION_TTL_MS = 5 * 60 * 1000;

interface MenuSession {
  userId: string;
  chatId: string;
  expiresAt: number;
}

const menuSessions = new Map<string, MenuSession>();

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

export function saveMenuSession(userId: string, chatId: string): void {
  menuSessions.set(buildKey(userId, chatId), {
    userId,
    chatId,
    expiresAt: Date.now() + MENU_SESSION_TTL_MS,
  });
}

export function hasActiveMenuSession(userId: string, chatId: string): boolean {
  const key = buildKey(userId, chatId);
  const session = menuSessions.get(key);

  if (!session) {
    return false;
  }

  if (session.expiresAt < Date.now()) {
    menuSessions.delete(key);
    return false;
  }

  return true;
}

export function clearMenuSession(userId: string, chatId: string): void {
  menuSessions.delete(buildKey(userId, chatId));
}
