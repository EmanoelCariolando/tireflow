import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import {
  clearGroupAdminCache,
  isMessageFromGroupAdmin,
} from '../src/services/groupAdminService.js';
import { handleIncomingMessage } from '../src/whatsapp/messageHandler.js';
import { clearMenuSession, getMenuSession } from '../src/utils/menuSessionStore.js';
import { clearProcessedMessages } from '../src/utils/messageDeduplication.js';
import {
  clearEntrySession,
  getEntrySession,
  saveEntrySession,
} from '../src/utils/entrySessionStore.js';

function createGroupMessage(
  userId: string,
  body: string,
  isAdmin: boolean,
  replies: string[],
  getChatCall?: () => void
): Message {
  return {
    author: userId,
    from: 'authorization-group@g.us',
    body,
    hasMedia: false,
    type: 'chat',
    id: { _serialized: `${userId}-${body}-${Date.now()}-${Math.random()}` },
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
    getChat: async () => {
      getChatCall?.();
      return {
        participants: [{
          id: {
            user: userId.split('@')[0]!,
            server: 'c.us',
            _serialized: userId,
          },
          isAdmin,
          isSuperAdmin: false,
        }],
      };
    },
  } as unknown as Message;
}

test('resolves the real group administrator and caches the result briefly', async () => {
  const replies: string[] = [];
  let getChatCalls = 0;
  const message = createGroupMessage(
    '551199999999:3@c.us',
    'menu',
    true,
    replies,
    () => { getChatCalls += 1; }
  );

  try {
    assert.equal(await isMessageFromGroupAdmin(message), true);
    assert.equal(await isMessageFromGroupAdmin(message), true);
    assert.equal(getChatCalls, 1);
  } finally {
    clearGroupAdminCache();
  }
});

test('matches an admin message LID to the participant phone identifier and caches the alias', async () => {
  const authorLid = '120675746508822@lid';
  const participantPhoneId = '5567999999999@c.us';
  let getChatCalls = 0;
  let getContactCalls = 0;
  let identifierResolverCalls = 0;
  const message = {
    author: authorLid,
    from: 'authorization-lid-group@g.us',
    client: {
      getContactLidAndPhone: async (ids: string[]) => {
        identifierResolverCalls += 1;
        assert.deepEqual(ids, [participantPhoneId]);
        return [{ lid: authorLid, pn: participantPhoneId }];
      },
    },
    getChat: async () => {
      getChatCalls += 1;
      return {
        participants: [{
          id: {
            user: '5567999999999',
            server: 'c.us',
            _serialized: participantPhoneId,
          },
          isAdmin: true,
          isSuperAdmin: false,
        }],
      };
    },
    getContact: async () => {
      getContactCalls += 1;
      return {
        id: {
          user: '120675746508822',
          server: 'lid',
          _serialized: authorLid,
        },
        number: '120675746508822',
      };
    },
  } as unknown as Message;

  try {
    assert.equal(await isMessageFromGroupAdmin(message), true);
    assert.equal(await isMessageFromGroupAdmin(message), true);
    assert.equal(getChatCalls, 1);
    assert.equal(identifierResolverCalls, 1);
    assert.equal(getContactCalls, 0);
  } finally {
    clearGroupAdminCache();
  }
});

test('does not promote a regular LID participant while resolving its phone alias', async () => {
  const message = {
    author: '120600000000001@lid',
    from: 'authorization-regular-lid-group@g.us',
    getChat: async () => ({
      participants: [{
        id: {
          user: '5567888888888',
          server: 'c.us',
          _serialized: '5567888888888@c.us',
        },
        isAdmin: false,
        isSuperAdmin: false,
      }],
    }),
    getContact: async () => ({
      id: {
        user: '5567888888888',
        server: 'c.us',
        _serialized: '5567888888888@c.us',
      },
      number: '5567888888888',
    }),
  } as unknown as Message;

  try {
    assert.equal(await isMessageFromGroupAdmin(message), false);
  } finally {
    clearGroupAdminCache();
  }
});

test('silently hides menu and direct administrative commands from regular members', async () => {
  const previousGroupId = env.whatsappOfficialGroupId;
  const previousPrivateMode = env.allowPrivateTestMode;
  const userId = '551188888888@c.us';
  const chatId = 'authorization-group@g.us';
  const replies: string[] = [];

  try {
    env.whatsappOfficialGroupId = chatId;
    env.allowPrivateTestMode = false;
    clearProcessedMessages();
    clearGroupAdminCache();

    await handleIncomingMessage(createGroupMessage(userId, 'menu', false, replies));
    await handleIncomingMessage(createGroupMessage(userId, 'entrada 1', false, replies));
    await handleIncomingMessage(createGroupMessage(userId, 'grupo id', false, replies));

    assert.deepEqual(replies, []);
    assert.equal(getMenuSession(userId, chatId), null);
  } finally {
    env.whatsappOfficialGroupId = previousGroupId;
    env.allowPrivateTestMode = previousPrivateMode;
    clearMenuSession(userId, chatId);
    clearProcessedMessages();
    clearGroupAdminCache();
  }
});

test('keeps the complete menu available to a real group administrator', async () => {
  const previousGroupId = env.whatsappOfficialGroupId;
  const previousPrivateMode = env.allowPrivateTestMode;
  const userId = '551177777777@c.us';
  const chatId = 'authorization-group@g.us';
  const replies: string[] = [];

  try {
    env.whatsappOfficialGroupId = chatId;
    env.allowPrivateTestMode = false;
    clearProcessedMessages();
    clearGroupAdminCache();

    await handleIncomingMessage(createGroupMessage(userId, 'menu', true, replies));

    assert.equal(replies.length, 1);
    assert.match(replies[0] ?? '', /TIREFLOW — MENU/);
    assert.match(replies[0] ?? '', /Relatório de hoje/);
    assert.match(replies[0] ?? '', /Cadastrar pneu/);
    assert.ok(getMenuSession(userId, chatId));
  } finally {
    env.whatsappOfficialGroupId = previousGroupId;
    env.allowPrivateTestMode = previousPrivateMode;
    clearMenuSession(userId, chatId);
    clearProcessedMessages();
    clearGroupAdminCache();
  }
});

test('closes an administrative conversation if the participant is not an admin', async () => {
  const previousGroupId = env.whatsappOfficialGroupId;
  const previousPrivateMode = env.allowPrivateTestMode;
  const userId = '551166666666@c.us';
  const chatId = 'authorization-group@g.us';
  const replies: string[] = [];

  try {
    env.whatsappOfficialGroupId = chatId;
    env.allowPrivateTestMode = false;
    clearProcessedMessages();
    clearGroupAdminCache();
    saveEntrySession({
      userId,
      chatId,
      step: 'awaiting_quantity',
      productId: 'admin-product',
      reference: '175/70 R14',
      description: 'PNEU ADMINISTRATIVO',
      oldCashPrice: 300,
      oldCreditPrice: 317.4,
      updatedAt: Date.now(),
    });

    await handleIncomingMessage(createGroupMessage(userId, '4', false, replies));

    assert.equal(getEntrySession(userId, chatId), null);
    assert.deepEqual(replies, []);
  } finally {
    env.whatsappOfficialGroupId = previousGroupId;
    env.allowPrivateTestMode = previousPrivateMode;
    clearEntrySession(userId, chatId);
    clearProcessedMessages();
    clearGroupAdminCache();
  }
});
