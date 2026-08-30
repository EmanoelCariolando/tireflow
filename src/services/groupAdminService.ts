import type { GroupParticipant, Message } from 'whatsapp-web.js';
import { getMessageChatId, getMessageUserId, isGroupMessage } from '../utils/messageContext.js';

const GROUP_ADMIN_CACHE_TTL_MS = 2 * 60 * 1000;

interface CachedGroupRoles {
  administrators: Set<string>;
  participantRoles: Map<string, boolean>;
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
  let roles = groupRoleCache.get(chatId);

  try {
    if (!roles || roles.expiresAt <= Date.now()) {
      if (typeof message.getChat !== 'function') {
        return false;
      }

      let pendingLoad = pendingGroupRoleLoads.get(chatId);
      if (!pendingLoad) {
        pendingLoad = loadGroupRoles(message);
        pendingGroupRoleLoads.set(chatId, pendingLoad);
      }

      roles = await pendingLoad;
      groupRoleCache.set(chatId, roles);
    }

    return await resolveParticipantRole(message, userId, roles);
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
  const administrators = new Set<string>();
  const participantRoles = new Map<string, boolean>();

  for (const participant of participants) {
    const participantId = normalizeWhatsAppId(participant.id._serialized);
    const isAdmin = Boolean(participant.isAdmin || participant.isSuperAdmin);
    participantRoles.set(participantId, isAdmin);
    if (isAdmin) {
      administrators.add(participantId);
    }
  }

  return {
    administrators,
    participantRoles,
    expiresAt: Date.now() + GROUP_ADMIN_CACHE_TTL_MS,
  };
}

async function resolveParticipantRole(
  message: Message,
  userId: string,
  roles: CachedGroupRoles
): Promise<boolean> {
  const normalizedUserId = normalizeWhatsAppId(userId);
  const cachedRole = roles.participantRoles.get(normalizedUserId);

  if (cachedRole !== undefined) {
    return cachedRole;
  }

  if (typeof message.getContact !== 'function') {
    roles.participantRoles.set(normalizedUserId, false);
    return false;
  }

  const contact = await message.getContact();
  const aliases = new Set<string>([normalizedUserId]);
  const serializedContactId = contact?.id?._serialized;
  if (serializedContactId) {
    aliases.add(normalizeWhatsAppId(serializedContactId));
  }
  if (contact?.number) {
    aliases.add(normalizeWhatsAppId(`${contact.number}@c.us`));
  }

  const isAdmin = [...aliases].some((alias) =>
    roles.administrators.has(alias) || roles.participantRoles.get(alias) === true
  );

  for (const alias of aliases) {
    if (!roles.participantRoles.has(alias) || alias === normalizedUserId) {
      roles.participantRoles.set(alias, isAdmin);
    }
  }

  return isAdmin;
}

export function clearGroupAdminCache(): void {
  groupRoleCache.clear();
  pendingGroupRoleLoads.clear();
}
