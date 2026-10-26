import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import whatsappWeb, { type Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import { DATA_DIRECTORY } from '../src/config/appPaths.js';
import * as scheduler from '../src/services/dailyReportScheduler.js';
import { whatsappClient } from '../src/whatsapp/client.js';
import { productRepository } from '../src/repositories/productRepository.js';

test('sends the current stock PDF every five days and replaces only its own successful pin', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const statePath = path.join(DATA_DIRECTORY, 'stock-report-state.json');
  const saved = { group: env.whatsappOfficialGroupId, time: env.dailyReportTime };
  env.dailyReportTime = '18:00'; env.whatsappOfficialGroupId = '120363000000055@g.us';
  const group = env.whatsappOfficialGroupId;
  await assert.rejects(whatsappClient.getPinnedMessages(group), /disabled in tests/);
  const sdkMessage = (whatsappWeb as typeof whatsappWeb & { Message: { prototype: Message } }).Message;
  await assert.rejects(sdkMessage.prototype.pin.call({} as Message, 604800), /disabled in tests/);
  await assert.rejects(sdkMessage.prototype.unpin.call({} as Message), /disabled in tests/);
  const events: string[] = [];
  let serial = 0, pinSucceeds = true, pinThrows = false, lookupUnsafe = false, pinnedCount = 0;
  t.mock.method(whatsappClient, 'getPinnedMessages', async () => Array.from({ length: pinnedCount }, () => ({} as Message)));
  const products = t.mock.method(productRepository, 'findActiveWithPositiveStock', async () => [
    { id: 'stock-tire', reference: '175/70 R14', description: 'OFFLINE TIRE', stock: 8, category: 'TIRE', stockLocation: null },
  ]);
  const send = t.mock.method(whatsappClient, 'sendMessage', async (recipient: string, media: { mimetype: string; data: string }, options: { caption: string }) => {
    assert.equal(recipient, group);
    assert.equal(media.mimetype, 'application/pdf');
    assert.equal(Buffer.from(media.data, 'base64').subarray(0, 5).toString(), '%PDF-');
    assert.match(options.caption, /Baixe.*sem internet/i);
    events.push('send');
    const id = `stock-${++serial}`;
    return { fromMe: true, type: 'document', id: { _serialized: id, id, remote: group, fromMe: true },
      pin: async (duration: number) => {
        assert.equal(duration, 7 * 24 * 60 * 60); events.push(`pin:${id}`);
        if (pinThrows) throw new Error('controlled pin failure');
        return pinSucceeds;
      },
    } as unknown as Message;
  });
  t.mock.method(whatsappClient, 'getMessageById', async (id: string) => ({ fromMe: !lookupUnsafe, type: 'document',
    id: { _serialized: id, id, remote: lookupUnsafe ? '120363000000099@g.us' : group, fromMe: !lookupUnsafe },
    unpin: async () => { events.push(`unpin:${id}`); return true; },
  } as unknown as Message));
  const deliver = (now: Date) => {
    assert.equal(typeof scheduler.sendStockReportIfDue, 'function', 'Stock delivery must be wired into the existing scheduler.');
    return scheduler.sendStockReportIfDue(now);
  };
  const read = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
  try {
    await fs.mkdir(DATA_DIRECTORY, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({ groupId: group, sentAt: new Date(2026, 10, 1, 18).toISOString(), pinnedMessageId: 'previous-pdf' }));
    await t.test('persisted success suppresses sending before five days and before the configured hour', async () => {
      await deliver(new Date(2026, 10, 5, 18)); await deliver(new Date(2026, 10, 6, 17, 59));
      assert.equal(send.mock.callCount(), 0);
    });
    await t.test('concurrent overdue checks send one PDF, pin it, then unpin the previous PDF', async () => {
      await Promise.all(Array.from({ length: 3 }, () => deliver(new Date(2026, 10, 6, 18))));
      assert.deepEqual(events, ['send', 'pin:stock-1', 'unpin:previous-pdf']);
      assert.equal((await read()).pinnedMessageId, 'stock-1');
      await deliver(new Date(2026, 10, 6, 23)); assert.equal(send.mock.callCount(), 1);
    });
    await t.test('failed delivery leaves the previous marker and can be retried', async () => {
      const before = await read();
      send.mock.mockImplementationOnce(async () => { throw new Error('controlled send failure'); });
      await deliver(new Date(2026, 10, 11, 18)); assert.deepEqual(await read(), before);
      await deliver(new Date(2026, 10, 11, 18, 1)); assert.equal((await read()).pinnedMessageId, 'stock-2');
    });
    await t.test('pin false or rejection preserves the old pin and never resends that PDF', async () => {
      for (const [day, throws] of [[17, false], [22, true]] as const) {
        events.length = 0; pinSucceeds = false; pinThrows = throws;
        await deliver(new Date(2026, 10, day, 18));
        const calls = send.mock.callCount();
        await deliver(new Date(2026, 10, day, 19));
        assert.equal(send.mock.callCount(), calls);
        assert.ok(events.every(event => !event.startsWith('unpin:')));
        assert.equal((await read()).pinnedMessageId, 'stock-2');
      }
      pinSucceeds = true; pinThrows = false;
    });
    await t.test('a recovered message from another conversation or sender cannot be unpinned', async () => {
      events.length = 0; lookupUnsafe = true;
      await deliver(new Date(2026, 10, 27, 18));
      assert.ok(events.some(event => event.startsWith('pin:')));
      assert.ok(events.every(event => !event.startsWith('unpin:')));
      lookupUnsafe = false;
    });
    await t.test('invalid state fails closed and a changed official group never reuses a foreign pin', async () => {
      await fs.writeFile(statePath, '{invalid');
      const calls = send.mock.callCount(); await deliver(new Date(2026, 11, 3, 18));
      assert.equal(send.mock.callCount(), calls);
      await fs.writeFile(statePath, JSON.stringify({ groupId: '120363000000099@g.us',
        sentAt: new Date(2026, 11, 3, 18).toISOString(), pinnedMessageId: 'foreign-pin' }));
      events.length = 0; await deliver(new Date(2026, 11, 3, 18));
      assert.ok(!events.includes('unpin:foreign-pin'));
      assert.equal((await read()).groupId, group);
    });
    await t.test('a full pinned-message list is preserved without trying to evict any notice', async () => {
      events.length = 0; pinnedCount = 3;
      const previous = (await read()).pinnedMessageId;
      await deliver(new Date(2026, 11, 8, 18));
      assert.deepEqual(events, ['send']);
      assert.equal((await read()).pinnedMessageId, previous);
    });
    await t.test('first use without state retries generation failure without recording a send', async () => {
      await fs.rm(statePath); events.length = 0; pinnedCount = 0;
      products.mock.mockImplementationOnce(async () => { throw new Error('controlled PDF generation failure'); });
      const calls = send.mock.callCount();
      await deliver(new Date(2026, 11, 14, 18));
      assert.equal(send.mock.callCount(), calls);
      await assert.rejects(fs.stat(statePath), { code: 'ENOENT' });
      await deliver(new Date(2026, 11, 14, 18, 1));
      assert.deepEqual(events, ['send', 'pin:stock-8']);
      assert.equal((await read()).pinnedMessageId, 'stock-8');
    });
  } finally { env.whatsappOfficialGroupId = saved.group; env.dailyReportTime = saved.time; await fs.rm(statePath, { force: true }); }
});
