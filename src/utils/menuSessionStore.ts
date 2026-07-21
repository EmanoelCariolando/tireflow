export type MenuSessionStep = 'awaiting_selection' | 'awaiting_low_stock_measure';

const MENU_SESSION_TTL_MS = 5 * 60 * 1000;

interface MenuSession {
  userId: string;
  chatId: string;
  step: MenuSessionStep;
  expiresAt: number;
}

const menuSessions = new Map<string, MenuSession>();

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

export function saveMenuSession(
  userId: string,
  chatId: string,
  step: MenuSessionStep = 'awaiting_selection'
): void {
  menuSessions.set(buildKey(userId, chatId), {
    userId,
    chatId,
    step,
    expiresAt: Date.now() + MENU_SESSION_TTL_MS,
  });
}

export function getMenuSession(userId: string, chatId: string): MenuSession | null {
  const key = buildKey(userId, chatId);
  const session = menuSessions.get(key);

  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    menuSessions.delete(key);
    return null;
  }

  return session;
}

export function clearMenuSession(userId: string, chatId: string): void {
  menuSessions.delete(buildKey(userId, chatId));
}
