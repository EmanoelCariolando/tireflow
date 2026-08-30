import type { GroupParticipant, Message } from 'whatsapp-web.js';
import { getMessageChatId, getMessageUserId, isGroupMessage } from '../utils/messageContext.js';

const GROUP_ADMIN_CACHE_TTL_MS = 2 * 60 * 1000;

interface CachedGroupRoles {
  administrators: Set<string>;
  participantRoles: Map<string, boolean>;
  expiresAt: number;
}

interface MessageWithIdentifierResolver {
  client?: {
    getContactLidAndPhone?: (
      userIds: string[]
    ) => Promise<Array<{ lid?: string; pn?: string }>>;
    pupPage?: {
      evaluate: (
        pageFunction: (groupId: string) => Promise<GroupParticipantSnapshot[]>,
        groupId: string
      ) => Promise<GroupParticipantSnapshot[]>;
    };
  };
}

interface GroupParticipantSnapshot {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
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
  const participants = await loadGroupParticipants(message);
  const administrators = new Set<string>();
  const participantRoles = new Map<string, boolean>();

  for (const participant of participants) {
    const participantId = normalizeWhatsAppId(participant.id);
    const isAdmin = Boolean(participant.isAdmin || participant.isSuperAdmin);
    participantRoles.set(participantId, isAdmin);
    if (isAdmin) {
      administrators.add(participantId);
    }
  }

  await addAdministratorAliases(
    message,
    participants
      .filter((participant) => participant.isAdmin || participant.isSuperAdmin)
      .map((participant) => participant.id),
    administrators,
    participantRoles
  );

  console.log('[AUTHORIZATION] Group roles loaded.', {
    participantCount: participants.length,
    administratorCount: participants.filter(
      (participant) => participant.isAdmin || participant.isSuperAdmin
    ).length,
    administratorIdentifierCount: administrators.size,
    messageAuthorIdType: getWhatsAppIdType(getMessageUserId(message)),
  });

  return {
    administrators,
    participantRoles,
    expiresAt: Date.now() + GROUP_ADMIN_CACHE_TTL_MS,
  };
}

async function loadGroupParticipants(message: Message): Promise<GroupParticipantSnapshot[]> {
  try {
    const chat = await message.getChat();
    const participants = 'participants' in chat
      ? (chat.participants as GroupParticipant[])
      : [];

    if (participants.length > 0) {
      return participants.map((participant) => ({
        id: participant.id._serialized,
        isAdmin: Boolean(participant.isAdmin),
        isSuperAdmin: Boolean(participant.isSuperAdmin),
      }));
    }
  } catch (error) {
    console.warn(
      '[AUTHORIZATION] Standard group lookup failed; using direct metadata fallback.',
      error
    );
  }

  return loadGroupParticipantsDirectly(message, getMessageChatId(message));
}

async function loadGroupParticipantsDirectly(
  message: Message,
  groupId: string
): Promise<GroupParticipantSnapshot[]> {
  const client = (message as unknown as MessageWithIdentifierResolver).client;
  const page = client?.pupPage;
  if (!page) {
    throw new Error('WhatsApp page is unavailable for the group metadata fallback.');
  }

  return page.evaluate(async (currentGroupId) => {
    interface BrowserParticipant {
      id?: { _serialized?: string };
      isAdmin?: boolean;
      isSuperAdmin?: boolean;
    }
    interface BrowserGroup {
      groupMetadata?: {
        participants?: {
          serialize?: () => BrowserParticipant[];
        };
      };
    }

    const requireModule = (globalThis as unknown as {
      require: (moduleName: string) => unknown;
    }).require;
    const widFactory = requireModule('WAWebWidFactory') as {
      createWid: (value: string) => unknown;
    };
    const collections = requireModule('WAWebCollections') as {
      Chat: {
        get: (id: unknown) => BrowserGroup | undefined;
        find: (id: unknown) => Promise<BrowserGroup | undefined>;
      };
    };
    const groupQuery = requireModule('WAWebGroupQueryJob') as {
      queryAndUpdateGroupMetadataById: (input: { id: string }) => Promise<unknown>;
    };
    const groupWid = widFactory.createWid(currentGroupId);
    let group = collections.Chat.get(groupWid) ?? await collections.Chat.find(groupWid);

    try {
      await groupQuery.queryAndUpdateGroupMetadataById({ id: currentGroupId });
      group = collections.Chat.get(groupWid) ?? group;
    } catch {
      // Cached metadata is still useful when WhatsApp refuses an explicit refresh.
    }

    const serializedParticipants = group?.groupMetadata?.participants?.serialize?.() ?? [];
    return serializedParticipants
      .map((participant) => ({
        id: participant.id?._serialized ?? '',
        isAdmin: Boolean(participant.isAdmin),
        isSuperAdmin: Boolean(participant.isSuperAdmin),
      }))
      .filter((participant) => Boolean(participant.id));
  }, groupId);
}

async function addAdministratorAliases(
  message: Message,
  administratorIds: string[],
  administrators: Set<string>,
  participantRoles: Map<string, boolean>
): Promise<void> {
  if (administratorIds.length === 0) {
    return;
  }

  const client = (message as unknown as MessageWithIdentifierResolver).client;
  const resolveIdentifiers = client?.getContactLidAndPhone;
  if (typeof resolveIdentifiers !== 'function') {
    return;
  }

  try {
    const mappings = await resolveIdentifiers.call(client, administratorIds);

    for (const mapping of mappings) {
      for (const identifier of [mapping.lid, mapping.pn]) {
        if (!identifier) continue;
        const alias = normalizeWhatsAppId(identifier);
        administrators.add(alias);
        participantRoles.set(alias, true);
      }
    }
  } catch (error) {
    console.warn(
      '[AUTHORIZATION] Could not resolve LID/phone aliases for group administrators.',
      error
    );
  }
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

function getWhatsAppIdType(value: string): string {
  const normalized = normalizeWhatsAppId(value);
  const separatorIndex = normalized.indexOf('@');
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : 'unknown';
}

export function clearGroupAdminCache(): void {
  groupRoleCache.clear();
  pendingGroupRoleLoads.clear();
}
