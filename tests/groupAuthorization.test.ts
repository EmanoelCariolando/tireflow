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
