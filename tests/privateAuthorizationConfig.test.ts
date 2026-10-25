import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function readConfig(mode?: string) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const source: NodeJS.ProcessEnv = { ...process.env, WHATSAPP_OFFICIAL_GROUP_ID: '120363000000001@g.us' };
  delete source.ALLOW_PRIVATE_TEST_MODE;
  if (mode !== undefined) source.ALLOW_PRIVATE_TEST_MODE = mode;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    env: source, encoding: 'utf8', timeout: 15000,
    input: `
      const { default: env, validateEnvironment } = await import('./src/config/env.ts');
      const enabled = env.allowPrivateTestMode;
      process.env.ALLOW_PRIVATE_TEST_MODE = enabled ? 'false' : 'true';
      const { handleIncomingMessage } = await import('./src/whatsapp/messageHandler.ts');
      const send = async (from, author) => {
        const replies = [];
        await handleIncomingMessage({from, author, fromMe:false,
          id:{id:from,_serialized:from,remote:from,fromMe:false},body:'menu',
          reply:async text=>replies.push(text)});
        return replies.some(text=>text.includes('TIREFLOW — MENU'));
      };
      const groupAllowed = await send(env.whatsappOfficialGroupId, '5583000000001@c.us');
      const privateAllowed = [];
      for (const sender of ['5583000000001@c.us', '5583000000002@lid']) privateAllowed.push(await send(sender));
      console.log(JSON.stringify({ enabled, unchanged: enabled === env.allowPrivateTestMode, groupAllowed, privateAllowed,
        errors: validateEnvironment({NODE_ENV:'production', DATABASE_URL:'file:./test.db', BRANCH_NAME:'TESTE',
          WHATSAPP_OFFICIAL_GROUP_ID:'120363000000001@g.us', BOSS_PRIVATE_NUMBER:'5583000000001', OWNER_PHONE:'5583000000001',
          DAILY_REPORT_TIME:'18:00', ALLOW_PRIVATE_TEST_MODE:${JSON.stringify(mode)}}) }));
    `,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
}

for (const mode of ['true', ' TRUE ', 'false', undefined, '', '   ', 'talvez', '1']) {
  test(`only an explicit true enables all technically valid private senders: ${JSON.stringify(mode)}`, () => {
    const config = readConfig(mode);
    const expected = mode?.trim().toLowerCase() === 'true';
    assert.equal(config.enabled, expected);
    assert.deepEqual(config.privateAllowed, [expected, expected]);
    assert.equal(config.groupAllowed, true);
    assert.equal(config.unchanged, true, 'Environment changes require a restart.');
    assert.deepEqual(config.errors, [], 'A private configuration error must not stop the official group.');
  });
}

test('restarting with a changed private flag applies the new policy', () => {
  assert.equal(readConfig('true').enabled, true);
  assert.equal(readConfig('false').enabled, false);
});
