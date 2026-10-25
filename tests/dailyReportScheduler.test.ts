import assert from 'node:assert/strict';
import test from 'node:test';
import { rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import env from '../src/config/env.js';
import { DAILY_REPORT_STATE_PATH } from '../src/config/appPaths.js';
import { sendReportIfDue } from '../src/services/dailyReportScheduler.js';
import { movementRepository } from '../src/repositories/movementRepository.js';
import { pendingSaleReportRepository } from '../src/repositories/pendingSaleReportRepository.js';
import { whatsappClient } from '../src/whatsapp/client.js';

test('daily delivery recovers only the current day and marks only successful sends', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const oldTime = env.dailyReportTime, oldOwner = env.ownerPhone;
  env.dailyReportTime = '18:00'; env.ownerPhone = '5583000000099';
  t.mock.method(movementRepository, 'findByDateRange', async () => []);
  t.mock.method(pendingSaleReportRepository, 'findByDateRange', async () => []);
  const target = t.mock.method(whatsappClient, 'getNumberId', async () => ({ _serialized: '5583000000099@c.us' }));
  const send = t.mock.method(whatsappClient, 'sendMessage', async () => ({}));
  const reset = async () => { await rm(DAILY_REPORT_STATE_PATH, { force: true }); send.mock.resetCalls(); };
  try {
    await t.test('a missing target is not marked as sent and can be retried', async () => {
      await reset(); target.mock.mockImplementationOnce(async () => null);
      await sendReportIfDue(new Date(2026, 10, 1, 18));
      await assert.rejects(readFile(DAILY_REPORT_STATE_PATH), { code: 'ENOENT' });
      assert.equal(send.mock.callCount(), 0);
      await sendReportIfDue(new Date(2026, 10, 1, 18, 2));
      assert.equal(send.mock.callCount(), 1);
    });
    await t.test('exhausted send retries do not mark success; later delivery works', async () => {
      await reset();
      send.mock.mockImplementation(async () => { throw new Error('controlled send failure'); });
      await sendReportIfDue(new Date(2026, 10, 2, 18));
      await assert.rejects(readFile(DAILY_REPORT_STATE_PATH), { code: 'ENOENT' });
      send.mock.mockImplementation(async () => ({})); send.mock.resetCalls();
      await sendReportIfDue(new Date(2026, 10, 2, 18, 3));
      assert.equal(send.mock.callCount(), 1);
    });
    for (const [day, minute] of [[3, 0], [4, 7]]) await t.test(`concurrent checks send once at 18:${minute}`, async () => {
      await reset();
      await Promise.all(Array.from({ length: 3 }, () => sendReportIfDue(new Date(2026, 10, day!, 18, minute))));
      assert.equal(send.mock.callCount(), 1);
      await sendReportIfDue(new Date(2026, 10, day!, 23, 59));
      assert.equal(send.mock.callCount(), 1);
    });
    await t.test('persisted success suppresses a new delivery; earlier times do not send yesterday', async () => {
      await reset(); await mkdir(path.dirname(DAILY_REPORT_STATE_PATH), { recursive: true });
      await writeFile(DAILY_REPORT_STATE_PATH, JSON.stringify({ lastSentDateKey: '2026-11-05' }));
      await sendReportIfDue(new Date(2026, 10, 5, 19));
      await sendReportIfDue(new Date(2026, 10, 6, 17, 59));
      assert.equal(send.mock.callCount(), 0);
      await sendReportIfDue(new Date(2026, 10, 6, 18));
      assert.equal(send.mock.callCount(), 1);
    });
  } finally { env.dailyReportTime = oldTime; env.ownerPhone = oldOwner; await rm(DAILY_REPORT_STATE_PATH, { force: true }); }
});
