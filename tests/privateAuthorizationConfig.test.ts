import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

function readConfig(mode?: string, nodeEnv = 'test') {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const source: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: nodeEnv, WHATSAPP_OFFICIAL_GROUP_ID: '120363000000001@g.us',
    BOSS_PRIVATE_NUMBER: '5583000000001', OWNER_PHONE: '5583000000001', DAILY_REPORT_TIME: '18:00',
  };
  delete source.ALLOW_PRIVATE_TEST_MODE;
  if (mode !== undefined) source.ALLOW_PRIVATE_TEST_MODE = mode;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module'], {
    env: source, encoding: 'utf8', timeout: 15000,
    input: `
      const { default: env, validateEnvironment, assertRuntimeEnvironment } = await import('./src/config/env.ts');
      const errors = validateEnvironment(process.env);
      let startupError = null;
      try { assertRuntimeEnvironment(); } catch (error) { startupError = error.message; }
      const enabled = env.allowPrivateTestMode;
      process.env.ALLOW_PRIVATE_TEST_MODE = enabled ? 'false' : 'true';
      const { handleIncomingMessage } = await import('./src/whatsapp/messageHandler.ts');
      const { clearAllOperationSessions } = await import('./src/utils/operationSessionCoordinator.ts');
      const { getMenuSession } = await import('./src/utils/menuSessionStore.ts');
      const { saveEntrySession, getEntrySession } = await import('./src/utils/entrySessionStore.ts');
      let nextId = 0;
      const send = async (from, author, body = 'menu') => {
        const replies = [];
        const id = 'private-config-' + ++nextId;
        await handleIncomingMessage({from, author, fromMe:false,
          id:{id,_serialized:id,remote:from,fromMe:false},body,
          reply:async text=>replies.push(text)});
        return replies;
      };
      const groupAllowed = (await send(env.whatsappOfficialGroupId, '5583000000001@c.us'))
        .some(text => text.includes('TIREFLOW — MENU'));
      const otherGroupReplies = await send('120363000000099@g.us', '5583000000001@c.us');
      const privateResults = [];
      // Exercise the router even when startup would reject the configuration.
      for (const sender of ['5583000000001@c.us', '5583000000002@lid']) {
        const menuReplies = await send(sender);
        const menuSession = Boolean(getMenuSession(sender, sender));
        clearAllOperationSessions(sender, sender);
        saveEntrySession({userId:sender,chatId:sender,step:'awaiting_quantity',
          productId:'synthetic',reference:'175/70 R14',description:'SYNTHETIC',
          oldCashPrice:100,oldCreditPrice:105.8,updatedAt:Date.now()});
        const replies = await send(sender, undefined, '4');
        const entry = getEntrySession(sender, sender);
        const cancelReplies = await send(sender, undefined, 'cancelar');
        privateResults.push({menuAllowed:menuReplies.some(text=>text.includes('TIREFLOW — MENU')),
          menuSession,step:entry?.step,quantity:entry?.quantity ?? null,replies,
          cancelled:getEntrySession(sender,sender) === null,cancelReplies});
        clearAllOperationSessions(sender, sender);
      }
      console.log(JSON.stringify({nodeEnv:env.nodeEnv,enabled,unchanged:enabled === env.allowPrivateTestMode,
        groupAllowed,otherGroupReplies,privateResults,errors,startupError}));
    `,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
}

for (const nodeEnv of ['test', 'development', ' DEVELOPMENT ', 'production', ' PRODUCTION ']) {
  for (const mode of ['true', ' TRUE ', 'false', ' FALSE ', undefined, '', '   ', 'talvez', '1']) {
    test(`private menus and continuations respect environment=${JSON.stringify(nodeEnv)} flag=${JSON.stringify(mode)}`, () => {
      const config = readConfig(mode, nodeEnv);
      const production = nodeEnv.trim().toLowerCase() === 'production';
      const expected = !production && mode?.trim().toLowerCase() === 'true';
      assert.equal(config.nodeEnv, nodeEnv.trim().toLowerCase());
      assert.equal(config.enabled, mode?.trim().toLowerCase() === 'true');
      assert.equal(config.groupAllowed, true, 'The router must preserve the official group.');
      assert.deepEqual(config.otherGroupReplies, []);
      assert.equal(config.unchanged, true, 'Environment changes require a restart.');
      for (const result of config.privateResults) {
        assert.equal(result.menuAllowed, expected);
        assert.equal(result.menuSession, expected);
        assert.equal(result.step, expected ? 'awaiting_invoice_number' : 'awaiting_quantity');
        assert.equal(result.quantity, expected ? 4 : null);
        assert.equal(result.cancelled, expected);
        if (expected) {
          assert.equal(result.replies.length, 1);
          assert.match(result.cancelReplies.join('\n'), /Operação cancelada/);
        } else {
          assert.deepEqual(result.replies, []);
          assert.deepEqual(result.cancelReplies, []);
        }
      }
      if (production && mode?.trim().toLowerCase() !== 'false') {
        assert.ok(config.errors.some((error: string) => error.startsWith('ALLOW_PRIVATE_TEST_MODE:')));
        assert.match(config.startupError, /ALLOW_PRIVATE_TEST_MODE:/);
      } else {
        assert.deepEqual(config.errors, []);
        assert.equal(config.startupError, null);
      }
    });
  }
}

test('restarting development with a changed private flag applies the new policy', () => {
  assert.equal(readConfig('true', 'development').privateResults[0].menuAllowed, true);
  assert.equal(readConfig('false', 'development').privateResults[0].menuAllowed, false);
});
