import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createHash } from 'node:crypto';

const root = process.cwd();
const patchName = 'whatsapp-web.js+1.34.7.patch';
const cli = path.join(root, 'node_modules/patch-package/index.js');

test('patches install on fresh, previously patched and fully patched dependencies', (t) => {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const fixture = mkdtempSync(path.join(root, 'tmp/patch-install-'));
  t.after(() => {
    const target = path.resolve(fixture);
    assert.equal(path.dirname(target), path.resolve(root, 'tmp'));
    assert.ok(path.basename(target).startsWith('patch-install-'));
    rmSync(target, { recursive: true, force: true });
  });
  const files = [
    'node_modules/whatsapp-web.js/package.json',
    'node_modules/whatsapp-web.js/src/Client.js',
    'node_modules/whatsapp-web.js/src/util/Injected/Utils.js',
    `patches/${patchName}`, `patches-media/${patchName}`,
  ];
  for (const file of files) {
    const destination = path.join(fixture, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(root, file), destination);
  }
  writeFileSync(path.join(fixture, 'package.json'), '{"name":"patch-fixture","version":"1.0.0"}');
  function run(directory: string, reverse = false) {
    const result = spawnSync(process.execPath, [cli, '--patch-dir', directory, '--error-on-fail', ...(reverse ? ['--reverse'] : [])], {
      cwd: fixture, encoding: 'utf8', timeout: 30_000,
    });
    return result;
  }
  function apply(directory: string, reverse = false) {
    const result = run(directory, reverse);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  // Restore the media file only to reproduce an installation with the old startup patch.
  apply('patches-media', true);
  mkdirSync(path.join(fixture, 'combined'));
  writeFileSync(path.join(fixture, 'combined', patchName),
    readFileSync(path.join(root, 'patches', patchName), 'utf8') +
    readFileSync(path.join(root, 'patches-media', patchName), 'utf8'));
  assert.equal(run('combined').status, 1, 'The former combined patch must reproduce the reported failure');
  apply('patches');
  apply('patches-media');
  // Repeated installation is safe.
  apply('patches');
  apply('patches-media');
  // Restore both original package files, then verify a clean installation.
  apply('patches-media', true);
  apply('patches', true);
  // These hashes come from the published npm 1.34.7 tarball, not our local dependency.
  // A patch generated against an already modified baseline must fail this check.
  const originals = {
    'src/Client.js': '36c70c1eb058087624e57ddea6b0c4d4a140faa2daf9c097dc670697ac321389',
    'src/util/Injected/Utils.js': '0d0f88565f481dbfeb9493b04b24033a2cb60f5fd2fd0e84e543b461d98878fe',
  };
  for (const [file, expected] of Object.entries(originals)) {
    const original = readFileSync(path.join(fixture, 'node_modules/whatsapp-web.js', file), 'utf8').replaceAll('\r\n', '\n');
    assert.equal(createHash('sha256').update(original).digest('hex'), expected, `Original npm file: ${file}`);
  }
  apply('patches');
  apply('patches-media');
  for (const file of Object.keys(originals)) {
    const checked = spawnSync(process.execPath, ['--check', path.join(fixture, 'node_modules/whatsapp-web.js', file)], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
  }
  const utils = readFileSync(path.join(fixture, files[2]!), 'utf8');
  assert.equal(utils.split('delete message.__x_id;').length - 1, 1);
  const client = readFileSync(path.join(fixture, files[1]!), 'utf8');
  assert.match(client, /_wwjsReadyRecoveryInterval/);
});
