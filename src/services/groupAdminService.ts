import type { GroupParticipant, Message } from 'whatsapp-web.js';
import { getMessageChatId, getMessageUserId, isGroupMessage } from '../utils/messageContext.js';

const GROUP_ADMIN_CACHE_TTL_MS = 2 * 60 * 1000;

interface CachedGroupRoles {
  administrators: Set<string>;
  expiresAt: number;
}

const groupRoleCache = new Map<string, CachedGroupRoles>();
const pendingGroupRoleLoads = new Map<string, Promise<CachedGroupRoles>>();

function normalizeWhatsAppId(value: string): string {
  const [rawUser = '', server = ''] = value.trim().toLowerCase().split('@', 2);
  const user = rawUser.split(':', 1)[0] ?? rawUser;
  return server ? `${user}@${server}` : user;
}

export async function isMessageFromGroupAdmin(message: Message): Promise<boolean> {
  // Private messages exist only in the explicit test mode and have no group hierarchy.
  if (!isGroupMessage(message)) {
    return true;
  }

  const chatId = getMessageChatId(message);
  const userId = getMessageUserId(message);
  const cached = groupRoleCache.get(chatId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.administrators.has(normalizeWhatsAppId(userId));
  }

  if (typeof message.getChat !== 'function') {
    return false;
  }

  try {
    let pendingLoad = pendingGroupRoleLoads.get(chatId);
    if (!pendingLoad) {
      pendingLoad = loadGroupRoles(message);
      pendingGroupRoleLoads.set(chatId, pendingLoad);
    }

    const roles = await pendingLoad;
    groupRoleCache.set(chatId, roles);
    return roles.administrators.has(normalizeWhatsAppId(userId));
  } catch (error) {
    console.warn('[AUTHORIZATION] Could not verify the group administrator role.', error);
    return false;
  } finally {
    pendingGroupRoleLoads.delete(chatId);
  }
}

async function loadGroupRoles(message: Message): Promise<CachedGroupRoles> {
  const chat = await message.getChat();
  const participants = 'participants' in chat
    ? (chat.participants as GroupParticipant[])
    : [];
  const administrators = new Set(
    participants
      .filter((participant) => participant.isAdmin || participant.isSuperAdmin)
      .map((participant) => normalizeWhatsAppId(participant.id._serialized))
  );

  return {
    administrators,
    expiresAt: Date.now() + GROUP_ADMIN_CACHE_TTL_MS,
  };
}

export function clearGroupAdminCache(): void {
  groupRoleCache.clear();
  pendingGroupRoleLoads.clear();
}
