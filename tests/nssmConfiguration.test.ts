import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const installer = readFileSync(
  path.join(process.cwd(), 'scripts', 'install-nssm-service.ps1'),
  'utf8'
);

test('NSSM executes the compiled application directly through Node.js', () => {
  assert.match(installer, /node\.exe/);
  assert.match(installer, /dist\\index\.js/);
  assert.match(installer, /AppParameters/);
  assert.match(installer, /AppDirectory/);
  assert.doesNotMatch(installer, /\bnpm\b/i);
  assert.doesNotMatch(installer, /\bpm2\b/i);
});

test('NSSM has isolated output, production environment and recovery settings', () => {
  assert.match(installer, /NODE_ENV=production/);
  assert.match(installer, /LOG_TO_CONSOLE=false/);
  assert.match(installer, /AppStdout/);
  assert.match(installer, /AppStderr/);
  assert.match(installer, /AppRotateFiles', '0/);
  assert.match(installer, /AppExit', 'Default', 'Restart/);
  assert.match(installer, /AppRestartDelay', '5000/);
  assert.match(installer, /SERVICE_AUTO_START/);
  assert.match(installer, /AppStopMethodConsole', '15000/);
  assert.match(installer, /AppKillProcessTree', '1/);
});

