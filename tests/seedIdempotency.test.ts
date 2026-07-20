import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('runs the product seed twice without duplicating products', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-seed-'));
  const databasePath = path.join(temporaryRoot, 'seed.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  await writeFile(databasePath, '');
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const environment = { ...process.env, DATABASE_URL: databaseUrl };
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: process.cwd(), env: environment, stdio: 'pipe',
    });
    const firstRun = execFileSync(process.execPath, [tsxCli, 'src/database/seedProducts.ts'], {
      cwd: process.cwd(), env: environment, encoding: 'utf8',
    });
    const secondRun = execFileSync(process.execPath, [tsxCli, 'src/database/seedProducts.ts'], {
      cwd: process.cwd(), env: environment, encoding: 'utf8',
    });
    const firstCreated = Number(firstRun.match(/Produtos criados: (\d+)/)?.[1]);
    const secondCreated = Number(secondRun.match(/Produtos criados: (\d+)/)?.[1]);
    assert.ok(firstCreated > 0);
    assert.equal(secondCreated, 0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
