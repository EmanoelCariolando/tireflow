import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('test configuration does not load even a fictitious .env', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'tireflow-env-test-'));
  try {
    mkdirSync(path.join(fixture, 'src/config'), { recursive: true });
    mkdirSync(path.join(fixture, 'src/utils'), { recursive: true });
    cpSync('src/config/env.ts', path.join(fixture, 'src/config/env.ts'));
    cpSync('src/utils/messageContext.ts', path.join(fixture, 'src/utils/messageContext.ts'));
    writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
    writeFileSync(path.join(fixture, '.env'), 'TIREFLOW_ENV_SENTINEL=must-not-load\n');
    symlinkSync(path.resolve('node_modules'), path.join(fixture, 'node_modules'), 'junction');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      await import(${JSON.stringify(pathToFileURL(path.join(fixture, 'src/config/env.ts')).href)});
      assert.equal(process.env.TIREFLOW_ENV_SENTINEL, undefined);
    `], { cwd: fixture, env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('runner excludes installation data, resets inherited configuration and blocks WhatsApp and network', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'tireflow-runner-test-'));
  try {
    for (const directory of ['src/config', 'src/utils', 'tests', 'prisma/migrations', 'uploads/products', 'data/wwebjs_auth']) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
    }
    for (const name of ['env.ts', 'appPaths.ts']) {
      cpSync(`src/config/${name}`, path.join(fixture, 'src/config', name));
    }
    cpSync('src/utils/messageContext.ts', path.join(fixture, 'src/utils/messageContext.ts'));
    if (existsSync('tests/offline.cjs')) cpSync('tests/offline.cjs', path.join(fixture, 'tests/offline.cjs'));
    writeFileSync(path.join(fixture, 'package.json'), '{"name":"isolation-fixture","type":"module"}');
    writeFileSync(path.join(fixture, 'prisma/schema.prisma'), '');
    const sentinels = new Map([
      ['.env', 'TIREFLOW_PRISMA_ENV_SENTINEL=must-not-load\n'],
      ...['prisma/production.db', 'uploads/products/real.jpg', 'data/wwebjs_auth/session']
        .map(name => [name, 'installation-must-remain'] as const),
    ]);
    for (const [name, content] of sentinels) writeFileSync(path.join(fixture, name), content);
    // Prisma's generated environment path must lead to this fictitious installation only.
    for (const name of ['.prisma/client', '@prisma/client']) {
      cpSync(path.join('node_modules', name), path.join(fixture, 'node_modules', name), { recursive: true });
    }
    for (const name of ['tsx', 'dotenv', 'whatsapp-web.js']) {
      symlinkSync(path.resolve('node_modules', name), path.join(fixture, 'node_modules', name), 'junction');
    }
    writeFileSync(path.join(fixture, 'tests/probe.test.ts'), `
      import assert from 'node:assert/strict';
      import { existsSync } from 'node:fs';
      import { spawnSync } from 'node:child_process';
      import test from 'node:test';
      import { PrismaClient } from '@prisma/client';
      import env from '../src/config/env.js';
      import { PROJECT_ROOT, PRODUCT_UPLOAD_DIRECTORY } from '../src/config/appPaths.js';
      import whatsapp from 'whatsapp-web.js';
      test('subprocess inherits offline guard without making a connection', () => {
        const result = spawnSync(process.execPath, ['-e', \`
          const assert = require('node:assert/strict');
          assert.match(require('whatsapp-web.js').Client.prototype.initialize.toString(), /disabled/i);
        \`], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      });
      test('isolated application', async () => {
        const client = new PrismaClient();
        try { assert.equal(process.env.TIREFLOW_PRISMA_ENV_SENTINEL, undefined); }
        finally { await client.$disconnect(); }
        assert.notEqual(PROJECT_ROOT, ${JSON.stringify(fixture)});
        assert.equal(existsSync('.env'), false);
        assert.equal(existsSync('prisma/production.db'), false);
        assert.equal(existsSync('uploads/products/real.jpg'), false);
        assert.equal(existsSync('data/wwebjs_auth/session'), false);
        assert.ok(env.databaseUrl.startsWith('file:' + PROJECT_ROOT.replaceAll('\\\\', '/')));
        assert.ok(env.whatsappAuthDataPath.startsWith(PROJECT_ROOT));
        assert.ok(PRODUCT_UPLOAD_DIRECTORY.startsWith(PROJECT_ROOT));
        assert.equal(env.bossPrivateNumber, '');
        assert.equal(env.allowPrivateTestMode, false);
        await assert.rejects(fetch('https://example.invalid'), /disabled/i);
        await assert.rejects(new whatsapp.Client().initialize(), /disabled/i);
      });
    `);
    const script = path.resolve('scripts/run-tests.cjs');
    const result = spawnSync(process.execPath, ['-e', `
      const { runTests } = require(${JSON.stringify(script)});
      process.exitCode = runTests(${JSON.stringify(fixture)}, ['tests/probe.test.ts']);
    `], { env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'file:DO-NOT-OPEN.db',
      WHATSAPP_AUTH_DATA_PATH: 'DO-NOT-OPEN', BOSS_PRIVATE_NUMBER: '11111111111', ALLOW_PRIVATE_TEST_MODE: 'true' },
      encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const [name, content] of sentinels) assert.equal(readFileSync(path.join(fixture, name), 'utf8'), content);
    assert.ok(existsSync(path.join(fixture, 'node_modules/tsx/package.json')));
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    rmSync(fixture, { recursive: true, force: true });
  }
});
