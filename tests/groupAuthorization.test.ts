import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import { clearProductRegistrationSession, getProductRegistrationSession } from '../src/utils/productRegistrationSessionStore.js';
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
  replies: string[],
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
      assert.fail('Command routing must not query group participant metadata');
    },
  } as unknown as Message;
}

test('opens the full menu and product registration without querying participant roles', async () => {
  const previousGroupId = env.whatsappOfficialGroupId;
  const previousPrivateMode = env.allowPrivateTestMode;
  const userId = '551177777777@c.us';
  const chatId = 'authorization-group@g.us';
  const replies: string[] = [];

  try {
    env.whatsappOfficialGroupId = chatId;
    env.allowPrivateTestMode = false;
    clearProcessedMessages();

    await handleIncomingMessage(createGroupMessage(userId, 'menu', replies));

    assert.equal(replies.length, 1);
    assert.match(replies[0] ?? '', /TIREFLOW — MENU/);
    assert.match(replies[0] ?? '', /Relatório de hoje/);
    assert.match(replies[0] ?? '', /Cadastrar pneu/);
    assert.match(replies[0] ?? '', /Relatório de estoque \(PDF\)/);
    assert.ok(getMenuSession(userId, chatId));
    await handleIncomingMessage(createGroupMessage(userId, '3', replies));
    assert.equal(getMenuSession(userId, chatId), null);
    assert.ok(getProductRegistrationSession(userId, chatId));
  } finally {
    env.whatsappOfficialGroupId = previousGroupId;
    env.allowPrivateTestMode = previousPrivateMode;
    clearMenuSession(userId, chatId);
    clearProductRegistrationSession(userId, chatId);
    clearProcessedMessages();
  }
});

test('continues an entry conversation without querying participant roles', async () => {
  const previousGroupId = env.whatsappOfficialGroupId;
  const previousPrivateMode = env.allowPrivateTestMode;
  const userId = '551166666666@c.us';
  const chatId = 'authorization-group@g.us';
  const replies: string[] = [];

  try {
    env.whatsappOfficialGroupId = chatId;
    env.allowPrivateTestMode = false;
    clearProcessedMessages();
    saveEntrySession({
      userId,
      chatId,
      step: 'awaiting_quantity',
      productId: 'entry-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      oldCashPrice: 300,
      oldCreditPrice: 317.4,
      updatedAt: Date.now(),
    });

    await handleIncomingMessage(createGroupMessage(userId, '4', replies));

    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_invoice_number');
    assert.equal(getEntrySession(userId, chatId)?.quantity, 4);
    assert.equal(replies.length, 1);
  } finally {
    env.whatsappOfficialGroupId = previousGroupId;
    env.allowPrivateTestMode = previousPrivateMode;
    clearEntrySession(userId, chatId);
    clearProcessedMessages();
  }
});

test('keeps other groups blocked and allows the group ID discovery command', async () => {
  const previousGroupId = env.whatsappOfficialGroupId;
  const replies: string[] = [];
  try {
    env.whatsappOfficialGroupId = 'another-group@g.us';
    await handleIncomingMessage(createGroupMessage('member@lid', 'menu', replies));
    assert.deepEqual(replies, []);
    await handleIncomingMessage(createGroupMessage('member@lid', 'grupo id', replies));
    assert.deepEqual(replies, ['ID deste grupo:\nauthorization-group@g.us']);
  } finally {
    env.whatsappOfficialGroupId = previousGroupId;
    clearProcessedMessages();
  }
});
