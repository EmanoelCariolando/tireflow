const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runTests(projectRoot = path.resolve(__dirname, '..'), requestedFiles = []) {
  const files = requestedFiles.length ? requestedFiles : fs.readdirSync(path.join(projectRoot, 'tests'))
    .filter(name => name.endsWith('.test.ts')).map(name => `tests/${name}`);
  for (const file of files) {
    if (!/^tests\/[\w.-]+\.test\.ts$/.test(file)) throw new Error('Select .test.ts files inside tests/.');
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tireflow-tests-'));
  const dependencyLinks = [];
  try {
    // Copy only source and public fixtures; never installation data or authentication.
    for (const name of ['src', 'tests', 'scripts', 'patches', 'patches-media', 'data/seed',
      'prisma/schema.prisma', 'prisma/migrations', 'package.json', 'package-lock.json',
      'tsconfig.json', 'README.md', '.env.example']) {
      const source = path.join(projectRoot, name);
      if (!fs.existsSync(source)) continue;
      fs.cpSync(source, path.join(workspace, name), { recursive: true, filter: filename => {
        const basename = path.basename(filename);
        if (basename.startsWith('.env') && basename !== '.env.example') return false;
        if (/\.(db|sqlite)(?:$|-)/i.test(basename)) return false;
        if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Test sources must not contain symbolic links.');
        return true;
      } });
    }
    const dependenciesRoot = path.join(projectRoot, 'node_modules');
    function addDependency(name) {
      const source = path.join(dependenciesRoot, name);
      const target = path.join(workspace, 'node_modules', name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Prisma resolves dotenv relative to its generated client, so it must live in the sandbox.
      if (name === '.prisma' || name === '@prisma/client') fs.cpSync(source, target, { recursive: true });
      else {
        fs.symlinkSync(fs.realpathSync(source), target, 'junction');
        dependencyLinks.push(target);
      }
    }
    for (const entry of fs.readdirSync(dependenciesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('@')) {
        for (const name of fs.readdirSync(path.join(dependenciesRoot, entry.name))) addDependency(`${entry.name}/${name}`);
      } else addDependency(entry.name);
    }
    fs.mkdirSync(path.join(workspace, 'uploads/products'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'prisma/test.db'), '');
    const environment = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT', 'COMSPEC', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME']) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    Object.assign(environment, {
      NODE_ENV: 'test', DATABASE_URL: `file:${path.join(workspace, 'prisma/test.db').replaceAll('\\', '/')}`,
      BRANCH_NAME: 'ATC PNEUS TESTE', WHATSAPP_AUTH_DATA_PATH: path.join(workspace, 'data/test-auth'),
      WHATSAPP_SESSION_NAME: 'tireflow-test', WHATSAPP_OFFICIAL_GROUP_ID: 'test@g.us',
      BOSS_PRIVATE_NUMBER: '', OWNER_PHONE: '', ALLOW_PRIVATE_TEST_MODE: 'false',
      LOG_TO_CONSOLE: 'false', TZ: 'America/Sao_Paulo',
      NODE_OPTIONS: `--require=${JSON.stringify(path.join(workspace, 'tests/offline.cjs').replaceAll('\\', '/'))}`,
    });
    const result = spawnSync(process.execPath, ['--import', 'tsx',
      '--test', '--test-concurrency=4', ...files], { cwd: workspace, env: environment, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    assert.equal(path.dirname(workspace), path.resolve(os.tmpdir()));
    for (const dependency of dependencyLinks) {
      assert.ok(fs.lstatSync(dependency).isSymbolicLink());
      fs.unlinkSync(dependency);
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

module.exports = { runTests };
if (require.main === module) process.exitCode = runTests(undefined, process.argv.slice(2));
