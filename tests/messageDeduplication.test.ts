import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import { clearProcessedMessages, markMessageForProcessing } from '../src/utils/messageDeduplication.js';

function messageWithId(id: string): Message {
  return { id: { _serialized: id } } as unknown as Message;
}

test('processes a WhatsApp message id only once inside the deduplication window', () => {
  clearProcessedMessages();
  const message = messageWithId('message-1');
  assert.equal(markMessageForProcessing(message, 1000), true);
  assert.equal(markMessageForProcessing(message, 1001), false);
});

test('accepts the same id after its deduplication window expires', () => {
  clearProcessedMessages();
  const message = messageWithId('message-2');
  assert.equal(markMessageForProcessing(message, 1000), true);
  assert.equal(markMessageForProcessing(message, 1000 + 10 * 60 * 1000 + 1), true);
});
