import assert from 'node:assert/strict';
import test from 'node:test';
import whatsapp from 'whatsapp-web.js';
import type { Client, Message } from 'whatsapp-web.js';
import { createRequire } from 'node:module';
import env from '../src/config/env.js';
import { handleIncomingMessage } from '../src/whatsapp/messageHandler.js';
import { clearMenuSession } from '../src/utils/menuSessionStore.js';

const SdkMessage = createRequire(import.meta.url)('whatsapp-web.js/src/structures/Message.js') as
  new (client: Client, data: Record<string, unknown>) => Message;

test('the installed SDK emits own messages only on message_create and foreign messages on both events', async () => {
  const client = new whatsapp.Client({}); // Never initialize: the page below is entirely simulated.
  const exposed = new Map<string, (message: unknown) => void>();
  Object.assign(client, { pupPage: {
    evaluate: async () => false,
    exposeFunction: async (name: string, callback: (message: unknown) => void) => { exposed.set(name, callback); },
  } });
  await (client as unknown as { attachEventListeners(): Promise<void> }).attachEventListeners();
  const created: boolean[] = [];
  const received: boolean[] = [];
  client.on('message_create', message => { created.push(message.fromMe); });
  client.on('message', message => { received.push(message.fromMe); });
  const callback = exposed.get('onAddMessageEvent');
  assert.ok(callback);
  for (const fromMe of [true, false]) callback({
    id: { id: 'sdk-test', _serialized: `sdk-${fromMe}`, remote: '5583000000001@c.us', fromMe },
    from: '5583000000001@c.us', to: '5583000000002@c.us', type: 'chat', body: 'menu',
  });
  assert.deepEqual(created, [true, false]);
  assert.deepEqual(received, [false]);
});

test('the receiver preserves rejection and propagates reply failures', async t => {
  const previous = { ...env };
  env.allowPrivateTestMode = true;
  env.whatsappOfficialGroupId = '120363000000001@g.us';
  t.mock.method(console, 'log', () => {});
  let next = 0;
  let replies = 0;
  const from = '5583000000001@lid';
  const message = (overrides: Record<string, unknown> = {}) => ({
    from, fromMe: false, body: 'menu', type: 'chat', hasMedia: false,
    id: { id: String(++next), _serialized: `receive-${next}-${from}`, remote: from, fromMe: false },
    reply: async () => { replies++; }, ...overrides,
  } as unknown as Message);
  try {
    await handleIncomingMessage(message());
    assert.equal(replies, 1);
    await handleIncomingMessage(message({ id: { id: 'bad', _serialized: 'bad', remote: '5583000000002@c.us', fromMe: false } }));
    assert.equal(replies, 1);
    env.allowPrivateTestMode = false;
    await handleIncomingMessage(message());
    assert.equal(replies, 1);
    env.allowPrivateTestMode = true;

    await handleIncomingMessage(message({ fromMe: true }));
    assert.equal(replies, 1);

    await assert.rejects(handleIncomingMessage(message({
      reply: async () => { throw new Error('RX_FAKE_SECRET_DO_NOT_LOG'); },
    })), /RX_FAKE_SECRET_DO_NOT_LOG/);
  } finally {
    clearMenuSession(from, from);
    Object.assign(env, previous);
  }
});

for (const [from, author] of [
  ['5583000000101@lid', undefined], ['5583000000102@c.us', undefined],
  ['120363000000001@g.us', '5583000000103@lid'],
] as const) {
  test(`SDK message without derived serialization reaches the menu and is deduplicated: ${from}`, async t => {
    const previous = { ...env };
    env.allowPrivateTestMode = true;
    env.whatsappOfficialGroupId = '120363000000001@g.us';
    const client = new whatsapp.Client({});
    const sent: Array<{ target: string; quote: unknown }> = [];
    const sdkMessage = (internalId = 'observed-message') => {
      const incoming = new SdkMessage(client, {
        id: { id: internalId, remote: from, fromMe: false },
        from: { _serialized: from }, author: author ? { _serialized: author } : undefined,
        type: 'chat', body: 'menu', broadcast: false,
      });
      // Mock this message's transport without removing the runner's global offline guard.
      incoming.reply = async content => client.sendMessage(incoming.from, content, { quotedMessageId: incoming.id._serialized });
      return incoming;
    };
    t.mock.method(client, 'sendMessage', async (target: string, _text: unknown, options: { quotedMessageId?: string }) => {
      sent.push({ target, quote: options.quotedMessageId });
      return sdkMessage();
    });
    try {
      const incoming = sdkMessage();
      assert.equal(incoming.id._serialized, undefined);
      await handleIncomingMessage(incoming);
      const expected = `false_${from}_observed-message${author ? `_${author}` : ''}`;
      assert.deepEqual(sent, [{ target: from, quote: expected }]);
      assert.equal(incoming.id._serialized, expected);
      await handleIncomingMessage(sdkMessage());
      assert.equal(sent.length, 1, 'A second SDK object for the same event must not repeat the operation.');
      await handleIncomingMessage(sdkMessage('legitimate-next-message'));
      assert.equal(sent.length, 2, 'A new message from the same sender must remain usable.');
    } finally {
      clearMenuSession(author ?? from, from);
      Object.assign(env, previous);
    }
  });
}
