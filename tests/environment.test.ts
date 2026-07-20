import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvironment } from '../src/config/env.js';

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./production.db',
    BRANCH_NAME: 'ATC PNEUS CONGO',
    WHATSAPP_OFFICIAL_GROUP_ID: '120363000000000000@g.us',
    BOSS_PRIVATE_NUMBER: '5583999999999',
    OWNER_PHONE: '5583999999999',
    DAILY_REPORT_TIME: '18:00',
    WHATSAPP_DEBUG: 'false',
    WHATSAPP_HEADLESS: 'true',
    ALLOW_PRIVATE_TEST_MODE: 'false',
    LOG_TO_CONSOLE: 'false',
  };
}

test('accepts a complete production environment without exposing values', () => {
  assert.deepEqual(validateEnvironment(validEnvironment()), []);
});

test('reports every missing required variable by name', () => {
  const errors = validateEnvironment({});
  for (const variableName of [
    'DATABASE_URL',
    'NODE_ENV',
    'BRANCH_NAME',
    'WHATSAPP_OFFICIAL_GROUP_ID',
    'BOSS_PRIVATE_NUMBER',
    'OWNER_PHONE',
    'DAILY_REPORT_TIME',
  ]) {
    assert.ok(errors.some((error) => error.startsWith(variableName)));
  }
});

test('accepts private test mode in production', () => {
  const source = validEnvironment();
  source.ALLOW_PRIVATE_TEST_MODE = 'true';
  assert.deepEqual(validateEnvironment(source), []);
});

test('rejects malformed values in production', () => {
  const source = validEnvironment();
  source.ALLOW_PRIVATE_TEST_MODE = 'talvez';
  source.WHATSAPP_OFFICIAL_GROUP_ID = 'grupo-invalido';
  source.DAILY_REPORT_TIME = '25:90';
  source.LOG_TO_CONSOLE = 'talvez';
  const errors = validateEnvironment(source);
  assert.ok(errors.some((error) => error.startsWith('ALLOW_PRIVATE_TEST_MODE')));
  assert.ok(errors.some((error) => error.startsWith('WHATSAPP_OFFICIAL_GROUP_ID')));
  assert.ok(errors.some((error) => error.startsWith('DAILY_REPORT_TIME')));
  assert.ok(errors.some((error) => error.startsWith('LOG_TO_CONSOLE')));
});
