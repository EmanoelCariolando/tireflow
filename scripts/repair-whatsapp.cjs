const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createGunzip } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const tar = require('tar-fs');

const VERSION = '1.34.7';
const SHA512 = 'CscRtB32OnozLj+cuG9Q5f7IhnNV2EU4RGRJYeYF7wwhN6acQ0efabnFpetSEh5Y8OL4YqBj7nSQbUrTZYLDGA==';
const FILES = ['src/Client.js', 'src/util/Injected/Utils.js'];

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || `${result.stdout}\n${result.stderr}`);
  }
  if (result.stdout.trim()) console.log(result.stdout.trim());
}

async function repair(root = path.resolve(__dirname, '..'), archivePath) {
  const installed = path.join(root, 'node_modules/whatsapp-web.js');
  const version = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version;
  if (version !== VERSION) throw new Error(`Esperado whatsapp-web.js ${VERSION}; encontrado ${version}.`);
  console.log('Preparando cópia original e validando os patches antes de alterar a biblioteca...');
  let archive;
  if (archivePath) {
    archive = fs.readFileSync(archivePath);
  } else {
    const response = await fetch(`https://registry.npmjs.org/whatsapp-web.js/-/whatsapp-web.js-${VERSION}.tgz`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Download falhou: HTTP ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha512').update(archive).digest('base64') !== SHA512) {
    throw new Error('O pacote baixado não corresponde ao pacote original. Nenhum arquivo foi alterado.');
  }
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, 'tmp/whatsapp-repair-'));
  const stagedPackage = path.join(staging, 'node_modules/whatsapp-web.js');
  fs.mkdirSync(stagedPackage, { recursive: true });
  await pipeline(Readable.from([archive]), createGunzip(), tar.extract(stagedPackage, {
    map(header) { header.name = header.name.replace(/^package\//, ''); return header; },
  }));
  fs.writeFileSync(path.join(staging, 'package.json'), '{"name":"whatsapp-repair","version":"1.0.0"}');
  for (const directory of ['patches', 'patches-media']) {
    fs.cpSync(path.join(root, directory), path.join(staging, directory), { recursive: true });
    run([require.resolve('patch-package/index.js'), '--patch-dir', directory, '--error-on-fail'], staging);
  }
  for (const file of FILES) run(['--check', path.join(stagedPackage, file)], staging);
  // Keep the previous files for diagnosis and rollback; do not touch session or database files.
  const backup = path.join(staging, 'backup');
  for (const file of FILES) {
    fs.mkdirSync(path.dirname(path.join(backup, file)), { recursive: true });
    fs.copyFileSync(path.join(installed, file), path.join(backup, file));
  }
  try {
    for (const file of FILES) fs.copyFileSync(path.join(stagedPackage, file), path.join(installed, file));
  } catch (error) {
    for (const file of FILES) fs.copyFileSync(path.join(backup, file), path.join(installed, file));
    throw error;
  }
  console.log(`Biblioteca reparada. Cópia dos arquivos anteriores: ${backup}`);
  console.log('Execute npm run check e reinicie o bot após a validação.');
}

module.exports = { repair };
if (require.main === module) {
  repair(undefined, process.argv[2]).catch((error) => {
    console.error(`Falha no reparo: ${error.message}`);
    process.exitCode = 1;
  });
}
